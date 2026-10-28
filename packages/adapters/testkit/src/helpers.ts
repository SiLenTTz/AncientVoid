import type { AdapterContext, EmittedEvent } from "@uacc/contracts";

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

