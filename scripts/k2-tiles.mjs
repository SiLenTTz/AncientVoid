#!/usr/bin/env node
/**
 * EPIC-P18 T18.6 (AC-P18-5): K2 with four tiles. Four dummy sessions at
 * 30 ev/s each, shown at once in the 2x2 workspace of a real Chromium
 * (2560x1440), frame lag = server emit -> row in that tile's DOM. Same
 * method as k2-frame-lag.mjs (wall clock both sides, warmup excluded),
 * four times the load in one page.
 *
 *   node scripts/k2-tiles.mjs [durationSeconds]
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLAYWRIGHT_MODULE =
  process.env.ANCIENTVOID_PLAYWRIGHT_MODULE ??
  "/home/silenttz/.local/share/mise/installs/npm-playwright/latest/node_modules/playwright/index.mjs";
const CHROMIUM_PATH = process.env.ANCIENTVOID_CHROMIUM_PATH ?? "/usr/bin/chromium";
const { chromium } = await import(PLAYWRIGHT_MODULE);

const RATE = 30;
const TILES = Number(process.env.K2_TILES ?? 4);
const DURATION_S = Number(process.argv[2] ?? 600);
const LAG_BUDGET_MS = 200;

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const { EventStore, SessionManager, AdapterRegistry, HubDatabase, TokenService } = await import(join(repoRoot, "packages/core/src/index.ts"));
const { ProcessRunner } = await import(join(repoRoot, "packages/workers/src/process.ts"));
const { createAdapter } = await import(join(repoRoot, "packages/adapters/dummy/src/index.ts"));
const { createHubApp } = await import(join(repoRoot, "apps/hub/src/index.ts"));

const dir = await mkdtemp(join(tmpdir(), "ancientvoid-k2t-"));
const db = new HubDatabase(":memory:");
const store = new EventStore(dir);
const registry = new AdapterRegistry();
registry.register("dummy", createAdapter, { eventsPerSecond: RATE, autoStopAfterEvents: 0, giantEvery: 0 });
const sessions = new SessionManager(db, store, registry, new ProcessRunner());
const tokens = new TokenService(db);
const { token } = tokens.issue("k2-tiles");
const app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false }, pwaDir: join(repoRoot, "apps/pwa/dist") });
await app.listen({ port: 0, host: "127.0.0.1" });
const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

const ids = [];
const emittedAt = new Map(); // `${id}:${seq}` -> ms
for (let i = 0; i < TILES; i++) {
  const record = await sessions.create({ adapter: "dummy", project: dir });
  ids.push(record.id);
  sessions.subscribe(record.id, (events) => {
    const t = Date.now();
    for (const e of events) if (!emittedAt.has(`${record.id}:${e.seq}`)) emittedAt.set(`${record.id}:${e.seq}`, t);
  });
}
console.log(`[k2-tiles] hub ${baseUrl}, ${TILES} dummy sessions @ ${RATE} ev/s for ${DURATION_S}s`);

const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
await page.addInitScript(
  ([tok, ws]) => {
    localStorage.setItem("ancientvoid.token", tok);
    localStorage.setItem("ancientvoid.workspace", ws);
    localStorage.setItem("ancientvoid.filter", "debuggen"); // every event renders
  },
  [token, JSON.stringify({ layout: TILES === 1 ? "1" : TILES === 2 ? "2v" : TILES === 3 ? "1+2" : "2x2", slots: ids.map((sessionId) => ({ sessionId })), focus: 0 })],
);
await page.goto(`${baseUrl}/`);
for (let n = 1; n <= TILES; n++) await page.waitForSelector(`.tile[data-tile="${n}"] .tail-scroll`, { timeout: 15_000 });

await page.evaluate((sessionIds) => {
  window.__renderedAt = {};
  document.querySelectorAll(".tile").forEach((tileEl) => {
    const id = sessionIds[Number(tileEl.dataset.tile) - 1];
    new MutationObserver((mutations) => {
      const now = Date.now();
      for (const m of mutations)
        for (const node of m.addedNodes)
          if (node.nodeType === 1 && node.dataset?.seq && !window.__renderedAt[`${id}:${node.dataset.seq}`]) window.__renderedAt[`${id}:${node.dataset.seq}`] = now;
    }).observe(tileEl.querySelector(".tail-scroll"), { childList: true, subtree: true });
  });
}, ids);

const measurementStart = Date.now();
while (Date.now() - measurementStart < DURATION_S * 1000) {
  await new Promise((r) => setTimeout(r, 10_000));
  console.log(`[k2-tiles] elapsed ${Math.round((Date.now() - measurementStart) / 1000)}s / ${DURATION_S}s`);
}
for (const id of ids) await sessions.stop(id).catch(() => undefined);
await page.waitForTimeout(500);
const renderedAt = await page.evaluate(() => window.__renderedAt);

const lags = [];
const byMinute = new Map(); // minute since start -> lags
const byTile = new Map(); // session id -> lags

const perTile = new Map(ids.map((id) => [id, 0]));
let warmup = 0;
for (const [key, renderTime] of Object.entries(renderedAt)) {
  const emitTime = emittedAt.get(key);
  if (emitTime === undefined) continue;
  if (emitTime < measurementStart) {
    warmup++;
    continue;
  }
  lags.push(renderTime - emitTime);
  const tileKey = key.split(":")[0];
  if (!byTile.has(tileKey)) byTile.set(tileKey, []);
  byTile.get(tileKey).push(renderTime - emitTime);
  const minute = Math.floor((emitTime - measurementStart) / 60_000);
  if (!byMinute.has(minute)) byMinute.set(minute, []);
  byMinute.get(minute).push(renderTime - emitTime);
  const id = key.split(":")[0];
  perTile.set(id, perTile.get(id) + 1);
}
const emittedInWindow = [...emittedAt.values()].filter((t) => t >= measurementStart).length;
lags.sort((a, b) => a - b);
const n = lags.length;
const at = (q) => (n ? lags[Math.min(n - 1, Math.floor(n * q))] : NaN);
const over = lags.filter((l) => l > LAG_BUDGET_MS);
console.log(`\n[k2-tiles] emitted in window: ${emittedInWindow}, rendered+matched: ${n}, warmup excluded: ${warmup}`);
console.log(`[k2-tiles] per tile: ${[...perTile.values()].join(" / ")}`);
console.log(`[k2-tiles] lag ms: min=${lags[0]} median=${at(0.5)} p95=${at(0.95)} p99=${at(0.99)} max=${lags[n - 1]}`);
console.log(`[k2-tiles] over ${LAG_BUDGET_MS}ms: ${over.length} of ${n}`);
for (const [i, id] of ids.entries()) {
  const xs = (byTile.get(id) ?? []).sort((x, y) => x - y);
  console.log(`[k2-tiles] tile ${i + 1}${i === 0 ? " (focus)" : ""}: median=${xs[Math.floor(xs.length / 2)]} p95=${xs[Math.floor(xs.length * 0.95)]} max=${xs[xs.length - 1]}`);
}
// Drift check: does the lag grow with the session's age?
for (const [minute, xs] of [...byMinute].sort((x, y) => x[0] - y[0])) {
  xs.sort((x, y) => x - y);
  console.log(`[k2-tiles] minute ${minute}: median=${xs[Math.floor(xs.length / 2)]} p95=${xs[Math.floor(xs.length * 0.95)]} max=${xs[xs.length - 1]} over=${xs.filter((l) => l > LAG_BUDGET_MS).length}`);
}

await browser.close();
await app.close();
await sessions.shutdown();
await rm(dir, { recursive: true, force: true });
console.log(over.length === 0 && n > 0 ? `\n[k2-tiles] PASS (AC-P18-5)` : `\n[k2-tiles] FAIL (AC-P18-5): ${over.length} over budget, ${n} matched`);
process.exitCode = over.length === 0 && n > 0 ? 0 : 1;
