#!/usr/bin/env node
/**
 * K2 messlauf: 30 events/s sustained for 10 minutes, through a REAL browser
 * rendering the Dashboard -> SessionTail path, measuring frame lag (server
 * emit -> DOM row rendered) end to end. AC-P1-3 requires < 200ms.
 *
 * Not an in-process shortcut and not `scripts/loadtest.mjs` (which measures
 * hub-internal throughput, never touches the browser): this drives the
 * actual PWA in a real Chromium via Playwright, because K2's own wording
 * is "durch Dashboard + Tail" - the rendering pipeline is the point.
 *
 * Prerequisite (not a repo dependency, not CI-run - see ADR-0002 for the
 * precedent of a local-only tool): Playwright + a system Chromium. Override
 * via env if your machine differs from the dev setup this was built on.
 *
 *   node scripts/k2-frame-lag.mjs [durationSeconds]
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLAYWRIGHT_MODULE =
  process.env.UACC_PLAYWRIGHT_MODULE ??
  "/home/silenttz/.local/share/mise/installs/npm-playwright/latest/node_modules/playwright/index.mjs";
const CHROMIUM_PATH = process.env.UACC_CHROMIUM_PATH ?? "/usr/bin/chromium";
const { chromium } = await import(PLAYWRIGHT_MODULE);

const RATE = 30;
const DURATION_S = Number(process.argv[2] ?? 600); // 10 minutes, per AC-P1-3 — real, not extrapolated (override via argv for a dry run).
const LAG_BUDGET_MS = 200;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(here);

const { EventStore, SessionManager, AdapterRegistry, HubDatabase, TokenService } = await import(
  join(repoRoot, "packages/core/src/index.ts")
);
const { ProcessRunner } = await import(join(repoRoot, "packages/workers/src/process.ts"));
const { createAdapter } = await import(join(repoRoot, "packages/adapter-dummy/src/index.ts"));
const { createHubApp } = await import(join(repoRoot, "packages/server/src/index.ts"));

const dir = await mkdtemp(join(tmpdir(), "uacc-k2-"));
const db = new HubDatabase(":memory:");
const store = new EventStore(dir);
const registry = new AdapterRegistry();
registry.register("dummy", createAdapter, { eventsPerSecond: RATE, autoStopAfterEvents: 0, giantEvery: 0 });
const sessions = new SessionManager(db, store, registry, new ProcessRunner());
const tokens = new TokenService(db);
const { token } = tokens.issue("k2-messlauf");

const app = await createHubApp({
  sessions,
  tokens,
  registry,
  auth: { tokens, enforceTailnetIdentity: false },
  pwaDir: join(repoRoot, "packages/pwa/dist"),
});
await app.listen({ port: 0, host: "127.0.0.1" });
const { port } = app.server.address();
const baseUrl = `http://127.0.0.1:${port}`;
console.log(`[k2] hub on ${baseUrl}, dummy @ ${RATE} ev/s for ${DURATION_S}s`);

const record = await sessions.create({ adapter: "dummy", project: dir });

// Server-side emit timestamps, keyed by seq (t0). Date.now() (wall clock),
// not performance.now() (process-relative) - has to be comparable with
// the browser's own Date.now() below, across two separate processes.
const emittedAt = new Map();
sessions.subscribe(record.id, (events) => {
  const t = Date.now();
  for (const e of events) if (!emittedAt.has(e.seq)) emittedAt.set(e.seq, t);
});

const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(`${baseUrl}/`);
await page.fill('input[type="password"]', token);
await page.click('button:has-text("Verbinden")');
await page.waitForSelector(".dashboard", { timeout: 10_000 });
await page.click(".session-card");
await page.waitForSelector(".filter-bar", { timeout: 10_000 });
// Debuggen: no preset filtering, every emitted event should render.
await page.click('button:has-text("Debuggen")');

// Record client-side render timestamps (t1) via MutationObserver, using
// Date.now() to match the server-side emit timestamps above.
await page.evaluate(() => {
  window.__renderedAt = {};
  const tail = document.querySelector("div[style*='overflow-y']");
  const obs = new MutationObserver((mutations) => {
    const now = Date.now();
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1 && node.dataset && node.dataset.seq) {
          window.__renderedAt[node.dataset.seq] = now;
        }
      }
    }
  });
  obs.observe(tail, { childList: true });
  window.__k2Observer = obs;
});

// Measurement start: only AFTER the browser has fully connected and is
// rendering live (page load + login + navigation + WS handshake are all
// done by this point). Events emitted before this get an artificially
// inflated "lag" once the WS replay-on-connect batch delivers them -
// that's a one-time cold-start cost, not the steady-state rendering
// latency K2 is actually about. Excluded explicitly, not silently.
const measurementStart = Date.now();
const t0 = measurementStart;
console.log(`[k2] running for ${DURATION_S}s...`);
while (Date.now() - t0 < DURATION_S * 1000) {
  await new Promise((r) => setTimeout(r, 10_000));
  console.log(`[k2] elapsed ${Math.round((Date.now() - t0) / 1000)}s / ${DURATION_S}s`);
}

await sessions.stop(record.id).catch(() => undefined);
await page.waitForTimeout(500);
const renderedAt = await page.evaluate(() => window.__renderedAt);

const lags = [];
let excludedWarmup = 0;
for (const [seqStr, renderTime] of Object.entries(renderedAt)) {
  const seq = Number(seqStr);
  const emitTime = emittedAt.get(seq);
  if (emitTime === undefined) continue;
  if (emitTime < measurementStart) {
    excludedWarmup++;
    continue;
  }
  lags.push(renderTime - emitTime);
}
console.log(`[k2] excluded as pre-connect warmup: ${excludedWarmup}`);
lags.sort((a, b) => a - b);
const n = lags.length;
const median = n ? lags[Math.floor(n / 2)] : NaN;
const p95 = n ? lags[Math.min(n - 1, Math.floor(n * 0.95))] : NaN;
const max = n ? lags[n - 1] : NaN;
const min = n ? lags[0] : NaN;
const over = lags.filter((l) => l > LAG_BUDGET_MS);

console.log(`\n[k2] emitted seqs: ${emittedAt.size}, rendered+matched: ${n}`);
console.log(`[k2] lag ms: min=${min} median=${median} p95=${p95} max=${max}`);
console.log(`[k2] over ${LAG_BUDGET_MS}ms budget: ${over.length} of ${n}`);

await browser.close();
await app.close();
await sessions.shutdown();
await rm(dir, { recursive: true, force: true });

console.log(
  over.length === 0
    ? `\n[k2] PASS (AC-P1-3): all ${n} matched events rendered within ${LAG_BUDGET_MS}ms`
    : `\n[k2] FAIL (AC-P1-3): ${over.length} events exceeded ${LAG_BUDGET_MS}ms (worst: ${max}ms)`,
);
process.exitCode = over.length === 0 ? 0 : 1;
