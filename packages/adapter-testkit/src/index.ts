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
  });

  const ctx = makeRecordingContext();
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
