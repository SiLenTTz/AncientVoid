import { readFileSync } from "node:fs";
import { EmittedEvent, type Adapter, type AdapterContext, type SessionSpec } from "@uacc/contracts";

/**
 * Adapter test kit — the hub's contract, executable.
 *
 * Contributors run `runContractTests(createAdapter)` against their adapter and
 * get the identical checks the hub applies at runtime. If these pass, the
 * adapter integrates (the whole point of the contract).
 */

/** In-memory AdapterContext capturing everything an adapter does. */
export interface RecordingContext extends AdapterContext {
  events: EmittedEvent[];
  blobs: { hash: string; bytes: number }[];
  spawned: string[][];
  logs: { level: string; msg: string }[];
}

export function makeRecordingContext(overrides?: Partial<RecordingContext>): RecordingContext {
  const ctx: RecordingContext = {
    sessionId: "test-session",
    events: [],
    blobs: [],
    spawned: [],
    logs: [],
    signal: new AbortController().signal,
    workdir: process.cwd(),
    emit: (ev) => ctx.events.push(ev),
    blob: async (data) => {
      const { createHash } = await import("node:crypto");
      const buf = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
      const hash = createHash("sha256").update(buf).digest("hex");
      const rec = { hash, bytes: buf.byteLength };
      ctx.blobs.push(rec);
      return { ...rec, path: `blobs/${hash}` };
    },
    spawnWorker: async (cmd) => {
      ctx.spawned.push(cmd);
      throw new Error("testkit: spawnWorker not simulated — override for worker tests");
    },
    log: (level, msg) => ctx.logs.push({ level, msg }),
    ...overrides,
  };
  return ctx;
}

export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3000,
  intervalMs = 25,
): Promise<void> {
  const t0 = Date.now();
  while (!predicate()) {
    if (Date.now() - t0 > timeoutMs) throw new Error("waitFor: timeout");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export interface ContractTestResult {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface ContractTestOptions {
  /** Time to wait for first events after start. */
  firstEventTimeoutMs?: number;
  /** Adapter config for the factory. */
  config?: Record<string, unknown>;
  /** Skip recover test (adapters without recover()). */
  skipRecover?: boolean;
  /** BUG-0004: adapters that call ctx.spawnWorker need a mock. The default
   * still throws so a missing override stays loud. */
  spawnWorker?: AdapterContext["spawnWorker"];
}

/**
 * Run the full contract suite against an adapter factory.
 * Returns per-check results — all green = hub-integrable.
 */
export async function runContractTests(
  factory: (config?: Record<string, unknown>) => Adapter,
  opts: ContractTestOptions = {},
): Promise<ContractTestResult[]> {
  const results: ContractTestResult[] = [];
  const check = (name: string, fn: () => void | Promise<void>) =>
    (async () => {
      try {
        await fn();
        results.push({ name, ok: true });
      } catch (err) {
        results.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err) });
      }
    })();

  const adapter = factory(opts.config);

  await check("identity: id + semver version", () => {
    if (!adapter.id || typeof adapter.id !== "string") throw new Error("missing id");
    if (!/^\d+\.\d+\.\d+/.test(adapter.version)) throw new Error("version must be semver");
  });

  await check("capabilities(): complete shape", () => {
    const caps = adapter.capabilities();
    for (const key of ["reasoning", "tools", "cost", "steer"] as const) {
      if (typeof caps[key] !== "boolean") throw new Error(`capabilities.${key} must be boolean`);
    }
    if (caps.nativeDiscovery !== "read-only" && caps.nativeDiscovery !== "none") {
      throw new Error("capabilities.nativeDiscovery must be read-only or none");
    }
    if (caps.nativeResume !== "native" && caps.nativeResume !== "none") {
      throw new Error("capabilities.nativeResume must be native or none");
    }
  });

  const ctx = makeRecordingContext(opts.spawnWorker ? { spawnWorker: opts.spawnWorker } : {});
  const spec: SessionSpec = {
    adapter: adapter.id,
    project: process.cwd(),
  };
  let handle = null as Awaited<ReturnType<Adapter["start"]>> | null;

  await check("start(): resolves to handle", async () => {
    handle = await adapter.start(spec, ctx);
    if (!handle || typeof handle.sessionId !== "string") throw new Error("no handle.sessionId");
  });

  await check("emits schema-valid events", async () => {
    await waitFor(() => ctx.events.length > 0, opts.firstEventTimeoutMs ?? 3000);
    for (const ev of ctx.events) {
      const parsed = EmittedEvent.safeParse(ev);
      if (!parsed.success) {
        throw new Error(`invalid event: ${parsed.error.issues[0]?.message}`);
      }
      if (ev.summary.length > 200) throw new Error("summary > 200 chars");
    }
  });

  await check("status(): health report", async () => {
    if (!handle) throw new Error("no handle");
    const rep = await adapter.status(handle);
    if (!["healthy", "degraded", "down", "broken"].includes(rep.state)) {
      throw new Error(`invalid health state: ${rep.state}`);
    }
  });

  await check("stop(): clean shutdown", async () => {
    if (!handle) throw new Error("no handle");
    await adapter.stop(handle, ctx);
    const rep = await adapter.status(handle);
    if (rep.state === "healthy") throw new Error("still healthy after stop");
  });

  if (!opts.skipRecover) {
    await check("recover(): optional but callable", async () => {
      if (!adapter.recover) return; // optional — absence is fine
      const recCtx = makeRecordingContext({ sessionId: "recovered-session" });
      const h = await adapter.recover("recovered-session", 0, recCtx);
      if (h === undefined) throw new Error("recover must return handle or null, not undefined");
      if (h) await adapter.stop(h, recCtx).catch(() => undefined);
    });
  }

  return results;
}

/** Assert helper: throws when any result failed. */
export function assertContractGreen(results: ContractTestResult[]): void {
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    throw new Error(
      `contract tests failed:\n${failed.map((f) => `  ✗ ${f.name}: ${f.detail}`).join("\n")}`,
    );
  }
}

/**
 * T1.4 fixture system — the generic half of the "load a captured
 * stream-json fixture, normalize every line, check the result" pattern
 * adapter-claude and adapter-codex each wrote by hand for T1.2/T1.3. The
 * provider-specific mapping logic stays in each adapter's own
 * normalize.ts (T1.1's conclusion: that part has no real second caller);
 * loading a fixture file and validating what came out of it against the
 * NormalizedEvent contract does, so it lives here.
 *
 * Record fixtures with `scripts/capture-adapter-fixture.mjs` (anonymizes
 * + secret-scans before writing) — AGENTS.md: "Fixtures für echte
 * CLI-Streams (P1): aufgezeichnet, anonymisiert, secret-gescannt — nie
 * Roh-Logs committen."
 */

/** Reads a `.jsonl` fixture (one JSON value per non-blank line). */
export function loadFixtureLines(path: string): unknown[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

/**
 * Asserts every event is schema-valid against the NormalizedEvent contract
 * (the same check runContractTests() runs on a live adapter's output —
 * the schema itself enforces the summary length cap, so this doesn't
 * duplicate that check). Throws with the offending event on the first
 * failure.
 */
export function assertFixtureEventsValid(events: readonly EmittedEvent[]): void {
  for (const ev of events) {
    const parsed = EmittedEvent.safeParse(ev);
    if (!parsed.success) {
      throw new Error(
        `invalid event from fixture: ${parsed.error.issues[0]?.message} — ${JSON.stringify(ev).slice(0, 300)}`,
      );
    }
  }
}

/**
 * Loads a fixture and runs it through an adapter's normalize function,
 * asserting every resulting event is schema-valid. Returns the events so
 * callers can layer their own provider-specific assertions on top.
 */
export function checkFixture(path: string, normalize: (line: unknown) => EmittedEvent[]): EmittedEvent[] {
  // Not `.flatMap(normalize)`: Array.flatMap's callback signature is
  // (item, index, array) — passing normalize directly hands a normalizer
  // with an optional second parameter (e.g. adapter-codex's `model`) the
  // line's numeric array index instead, silently. Wrapping in an arrow
  // forwards exactly one argument, matching this function's own signature.
  const events = loadFixtureLines(path).flatMap((line) => normalize(line));
  assertFixtureEventsValid(events);
  return events;
}
