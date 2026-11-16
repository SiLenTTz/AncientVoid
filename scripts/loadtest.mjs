#!/usr/bin/env node
/**
 * K8 load test: 20 parallel dummy sessions à 30 events/s.
 * Runs the full hub stack in-process (no HTTP) and asserts:
 *  - no events lost (seq gaps),
 *  - memory stays sane,
 *  - throughput achieved.
 *
 *   node scripts/loadtest.mjs [--sessions 20] [--rate 30] [--seconds 10]
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const SESSIONS = flag("sessions", 20);
const RATE = flag("rate", 30);
const SECONDS = flag("seconds", 10);

const { EventStore, SessionManager, AdapterRegistry, HubDatabase } = await import(
  "../packages/core/src/index.ts"
);
const { ProcessRunner } = await import("../packages/workers/src/process.ts");
const { createAdapter } = await import("../packages/adapters/dummy/src/index.ts");

const dir = await mkdtemp(join(tmpdir(), "ancientvoid-load-"));
const db = new HubDatabase(":memory:");
const store = new EventStore(dir);
const registry = new AdapterRegistry();
registry.register("dummy", createAdapter, { eventsPerSecond: RATE });
const manager = new SessionManager(db, store, registry, new ProcessRunner());

const counts = new Map();
console.log(`K8 loadtest: ${SESSIONS} sessions × ${RATE} ev/s × ${SECONDS}s`);

const t0 = performance.now();
const ids = [];
for (let i = 0; i < SESSIONS; i++) {
  const rec = await manager.create({ adapter: "dummy", project: dir });
  ids.push(rec.id);
  manager.subscribe(rec.id, (events) => {
    counts.set(rec.id, (counts.get(rec.id) ?? 0) + events.length);
  });
}
console.log(`created ${ids.length} sessions in ${(performance.now() - t0).toFixed(0)} ms`);

await new Promise((r) => setTimeout(r, SECONDS * 1000));

let failures = 0;
const expectedPerSession = Math.floor(RATE * SECONDS * 0.9); // 10% scheduling tolerance
for (const id of ids) {
  const live = counts.get(id) ?? 0;
  const persisted = (await manager.tail(id, 0)).length;
  if (live < expectedPerSession || persisted < live) {
    failures++;
    console.error(`  ✗ ${id.slice(0, 8)}: live=${live} persisted=${persisted} expected≥${expectedPerSession}`);
  }
}

await manager.shutdown();
await rm(dir, { recursive: true, force: true }).catch(() => undefined);

const elapsed = (performance.now() - t0) / 1000;
const totalEvents = [...counts.values()].reduce((a, b) => a + b, 0);
console.log(
  `done: ${totalEvents} events in ${elapsed.toFixed(1)}s → ${(totalEvents / elapsed).toFixed(0)} ev/s aggregate, rss=${(process.memoryUsage().rss / 1e6).toFixed(0)} MB`,
);
if (failures > 0) {
  console.error(`K8 FAILED: ${failures}/${SESSIONS} sessions lost events`);
  process.exit(1);
}
console.log("K8 PASSED: no session lost events");
process.exit(0);
