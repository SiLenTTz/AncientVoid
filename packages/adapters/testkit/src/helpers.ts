import type { AdapterContext, EmittedEvent, EmittedStreamFrame } from "@ancientvoid/contracts";

/** In-memory AdapterContext capturing everything an adapter does. */
export interface RecordingContext extends AdapterContext {
  events: EmittedEvent[];
  blobs: { hash: string; bytes: number }[];
  spawned: string[][];
  logs: { level: string; msg: string }[];
  /** ADR-0083: live frames the adapter sent (transient, never an event). */
  frames: EmittedStreamFrame[];
}

export function makeRecordingContext(overrides?: Partial<RecordingContext>): RecordingContext {
  const ctx: RecordingContext = {
    sessionId: "test-session",
    events: [],
    blobs: [],
    spawned: [],
    logs: [],
    frames: [],
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
    // ADR-0083: standardmaessiger Stream-Kanal — Adapter-Tests hoeren die Frames ab.
    stream: (f) => ctx.frames.push(f),
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

