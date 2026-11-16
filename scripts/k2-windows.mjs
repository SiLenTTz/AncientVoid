#!/usr/bin/env node
/**
 * EPIC-P34 T34.12 (AC-P34-12): K2 mit vier eigenen Fenstern. Vier Dummy-Sessions mit je 30 ev/s, jede in einem eigenen
 * Fenster (`/?window=1#/sessions/<id>`, schlanke Hülle) eines echten Chromium, dazu ein Hauptfenster mit leerem
 * Arbeitsbereich. Verzögerung = Server-Emit → Zeile im DOM des Fensters. Gleiche Methode wie k2-tiles.mjs (Wanduhr auf
 * beiden Seiten, Aufwärmphase ausgeschlossen).
 *
 *   K2_WINDOWS=4 node scripts/k2-windows.mjs [durationSeconds]
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLAYWRIGHT_MODULE =
  process.env.ANCIENTVOID_PLAYWRIGHT_MODULE ??
  "/home/dev/.local/share/mise/installs/npm-playwright/latest/node_modules/playwright/index.mjs";
const CHROMIUM_PATH = process.env.ANCIENTVOID_CHROMIUM_PATH ?? "/usr/bin/chromium";
const { chromium } = await import(PLAYWRIGHT_MODULE);

const RATE = 30;
const TILES = Number(process.env.K2_WINDOWS ?? 4);
const DURATION_S = Number(process.argv[2] ?? 600);
const LAG_BUDGET_MS = 200;

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const { EventStore, SessionManager, AdapterRegistry, HubDatabase, TokenService } = await import(join(repoRoot, "packages/core/src/index.ts"));
const { ProcessRunner } = await import(join(repoRoot, "packages/workers/src/process.ts"));
const { createAdapter } = await import(join(repoRoot, "packages/adapters/dummy/src/index.ts"));
const { createHubApp } = await import(join(repoRoot, "apps/hub/src/index.ts"));

const dir = await mkdtemp(join(tmpdir(), "ancientvoid-k2w-"));
const db = new HubDatabase(":memory:");
const store = new EventStore(dir);
const registry = new AdapterRegistry();
registry.register("dummy", createAdapter, { eventsPerSecond: RATE, autoStopAfterEvents: 0, giantEvery: 0 });
const sessions = new SessionManager(db, store, registry, new ProcessRunner());
const tokens = new TokenService(db);
const { token } = tokens.issue("k2-windows");
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
console.log(`[k2-windows] hub ${baseUrl}, ${TILES} dummy sessions @ ${RATE} ev/s for ${DURATION_S}s`);

// Tabs eines Fensters werden im Hintergrund auf 1 s gedrosselt; echte Fenster nebeneinander nicht. K2_THROTTLE=1 lässt
// die Drosselung an (Lauf 1 im Bericht), sonst bilden die Flags getrennte, sichtbare Fenster nach.
const noThrottle = process.env.K2_THROTTLE === "1" ? [] : ["--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"];
const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, args: ["--no-sandbox", ...noThrottle] });
// Ein Kontext je Fenster: Tabs eines Kontexts gelten nur für den aktiven als sichtbar (Hintergrund-Tabs liefern ~1 Hz),
// getrennte Fenster dagegen je für sich. K2_SHARED=1 nutzt einen gemeinsamen Kontext (Läufe 1 und 2 im Bericht).
const initScript = ([tok]) => {
  localStorage.setItem("ancientvoid.token", tok);
  localStorage.setItem("ancientvoid.filter", "debuggen"); // every event renders
};
const newWindow = async (viewport, url) => {
  const context = process.env.K2_SHARED === "1" ? (sharedContext ??= await browser.newContext()) : await browser.newContext();
  await context.addInitScript(initScript, [token]);
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(url);
  return page;
};
let sharedContext;
// Das Hauptfenster (Liste, leerer Arbeitsbereich) läuft mit, wie im Betrieb.
const main = await newWindow({ width: 1440, height: 900 }, `${baseUrl}/`);
const pages = [];
for (const id of ids) {
  const page = await newWindow({ width: 1280, height: 800 }, `${baseUrl}/?window=1#/sessions/${encodeURIComponent(id)}`);
  await page.waitForSelector(".tile .tail-scroll", { timeout: 15_000 });
  await page.evaluate((sessionId) => {
    window.__renderedAt = {};
    new MutationObserver((mutations) => {
      const now = Date.now();
      for (const m of mutations)
        for (const node of m.addedNodes)
          if (node.nodeType === 1 && node.dataset?.seq && !window.__renderedAt[`${sessionId}:${node.dataset.seq}`]) window.__renderedAt[`${sessionId}:${node.dataset.seq}`] = now;
    }).observe(document.querySelector(".tile .tail-scroll"), { childList: true, subtree: true });
  }, id);
  pages.push(page);
}

const measurementStart = Date.now();
while (Date.now() - measurementStart < DURATION_S * 1000) {
  await new Promise((r) => setTimeout(r, 10_000));
  console.log(`[k2-windows] elapsed ${Math.round((Date.now() - measurementStart) / 1000)}s / ${DURATION_S}s`);
}
for (const id of ids) await sessions.stop(id).catch(() => undefined);
await main.waitForTimeout(500);
const renderedAt = {};
for (const page of pages) Object.assign(renderedAt, await page.evaluate(() => window.__renderedAt));

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
console.log(`\n[k2-windows] emitted in window: ${emittedInWindow}, rendered+matched: ${n}, warmup excluded: ${warmup}`);
console.log(`[k2-windows] per window: ${[...perTile.values()].join(" / ")}`);
console.log(`[k2-windows] lag ms: min=${lags[0]} median=${at(0.5)} p95=${at(0.95)} p99=${at(0.99)} max=${lags[n - 1]}`);
console.log(`[k2-windows] over ${LAG_BUDGET_MS}ms: ${over.length} of ${n}`);
for (const [i, id] of ids.entries()) {
  const xs = (byTile.get(id) ?? []).sort((x, y) => x - y);
  console.log(`[k2-windows] window ${i + 1}: median=${xs[Math.floor(xs.length / 2)]} p95=${xs[Math.floor(xs.length * 0.95)]} max=${xs[xs.length - 1]}`);
}
// Drift check: does the lag grow with the session's age?
for (const [minute, xs] of [...byMinute].sort((x, y) => x[0] - y[0])) {
  xs.sort((x, y) => x - y);
  console.log(`[k2-windows] minute ${minute}: median=${xs[Math.floor(xs.length / 2)]} p95=${xs[Math.floor(xs.length * 0.95)]} max=${xs[xs.length - 1]} over=${xs.filter((l) => l > LAG_BUDGET_MS).length}`);
}

await browser.close();
await app.close();
await sessions.shutdown();
await rm(dir, { recursive: true, force: true });
console.log(over.length === 0 && n > 0 ? `\n[k2-windows] PASS (AC-P34-12)` : `\n[k2-windows] FAIL (AC-P34-12): ${over.length} over budget, ${n} matched`);
process.exitCode = over.length === 0 && n > 0 ? 0 : 1;
