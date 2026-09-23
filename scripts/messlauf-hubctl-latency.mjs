#!/usr/bin/env node
/**
 * Messlauf (AI-P0-3): hubctl tail end-to-end latency, against AC-P0-5
 * ("hubctl tail <session> zeigt Events mit < 500 ms Ende-zu-Ende-Latenz").
 *
 * Measures through the REAL transport, not an in-process shortcut: a real
 * HTTP+WS server (createHubApp, real socket on 127.0.0.1) and the real
 * hubctl CLI spawned as its own child process. The AC is about what a
 * phone/browser actually experiences, which is exactly this path.
 *
 * Latency = server-side "event emitted to subscribers" timestamp vs. the
 * moment the matching line lands in hubctl's own stdout.
 *
 *   node scripts/messlauf-hubctl-latency.mjs [--events 20] [--rate 5]
 *
 * Per the messlauf skill: this script measures and prints a verdict; the
 * result of an actual run is filed under docs/messlauf/ with environment,
 * commit and command — this script alone is not the record.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const EVENTS = flag("events", 20);
const RATE = flag("rate", 5);

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

const { EventStore, SessionManager, AdapterRegistry, HubDatabase, TokenService } = await import(
  "../packages/core/src/index.ts"
);
const { ProcessRunner } = await import("../packages/workers/src/process.ts");
const { createAdapter } = await import("../packages/adapters/dummy/src/index.ts");
const { createHubApp } = await import("../apps/hub/src/app.ts");

const dir = await mkdtemp(join(tmpdir(), "uacc-messlauf-"));
const db = new HubDatabase(":memory:");
const store = new EventStore(dir);
const registry = new AdapterRegistry();
registry.register("dummy", createAdapter, { eventsPerSecond: RATE, autoStopAfterEvents: EVENTS });
const sessions = new SessionManager(db, store, registry, new ProcessRunner());
const tokens = new TokenService(db);
const { token } = tokens.issue("messlauf-hubctl-latency");

const app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false } });
await app.listen({ port: 0, host: "127.0.0.1" });
const { port } = app.server.address();
const baseUrl = `http://127.0.0.1:${port}`;

console.log(`hub listening on ${baseUrl}, dummy adapter @ ${RATE} ev/s, ${EVENTS} events`);
const record = await sessions.create({ adapter: "dummy", project: dir });

// Server-side "emitted to subscribers" timestamp, keyed by seq — this is
// t0. It's taken at the same point the WS layer (registerWs) itself
// subscribes, so it reflects what actually starts the trip to the client.
const emittedAt = new Map();
sessions.subscribe(record.id, (events) => {
  const t = process.hrtime.bigint();
  for (const e of events) if (!emittedAt.has(e.seq)) emittedAt.set(e.seq, t);
});

// The real hubctl CLI, real WS transport — this is t1.
const hubctl = spawn(process.execPath, [join(repoRoot, "apps/hubctl/src/cli.ts"), "tail", record.id, "-f"], {
  cwd: repoRoot,
  env: { ...process.env, UACC_URL: baseUrl, UACC_TOKEN: token },
});

const receivedAt = new Map();
let buffer = "";
hubctl.stdout.on("data", (chunk) => {
  const t = process.hrtime.bigint();
  buffer += chunk.toString("utf8");
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    const m = line.match(/#(\d+)\s/);
    if (m) receivedAt.set(Number(m[1]), t);
  }
});
hubctl.stderr.on("data", (d) => process.stderr.write(`[hubctl stderr] ${d}`));

// Fixed wait, not a completion-signal poll: nominal generation time plus a
// fixed buffer for process/WS startup overhead. Simplicity over precision
// here — the measurement is per-seq (emittedAt vs. receivedAt), so exactly
// how many of the ~EVENTS+3 events (2 lifecycle + N dummy + 1 auto-stop)
// land before the wait ends doesn't bias the latency numbers themselves.
const waitMs = Math.max(3000, (EVENTS / RATE) * 1000 + 2000);
await new Promise((r) => setTimeout(r, waitMs));

hubctl.kill("SIGTERM");
await app.close();
await sessions.shutdown();
await rm(dir, { recursive: true, force: true });

const latenciesMs = [];
for (const [seq, t1] of receivedAt) {
  const t0 = emittedAt.get(seq);
  if (t0 !== undefined) latenciesMs.push(Number(t1 - t0) / 1e6);
}
latenciesMs.sort((a, b) => a - b);
const n = latenciesMs.length;

if (n === 0) {
  console.error("no events matched between server-emit and hubctl-stdout — measurement invalid");
  process.exit(1);
}

const median = latenciesMs[Math.floor(n / 2)];
const p95 = latenciesMs[Math.min(n - 1, Math.floor(n * 0.95))];
const max = latenciesMs[n - 1];
const min = latenciesMs[0];

console.log(`\nhubctl tail latency — n=${n} events matched`);
console.log(`  min=${min.toFixed(1)}ms  median=${median.toFixed(1)}ms  p95=${p95.toFixed(1)}ms  max=${max.toFixed(1)}ms`);
console.log(`  raw (ms): ${latenciesMs.map((v) => v.toFixed(1)).join(", ")}`);

if (max >= 500) {
  console.error(`\nFAIL (AC-P0-5): max latency ${max.toFixed(1)}ms >= 500ms`);
  process.exit(1);
}
console.log(`\nPASS (AC-P0-5): all ${n} matched events < 500ms`);
