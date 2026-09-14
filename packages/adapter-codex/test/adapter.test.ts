import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { WorkerProcess } from "@uacc/contracts";
import { EmittedEvent } from "@uacc/contracts";
import { makeRecordingContext, waitFor } from "@uacc/adapter-testkit";
import { createAdapter } from "../src/index.ts";

/**
 * Same testkit gap as adapter-claude (BUG-0004): runContractTests() can't
 * exercise a spawnWorker-using adapter, so this builds its own lifecycle
 * test directly on makeRecordingContext({ spawnWorker: ... }).
 */

const here = dirname(fileURLToPath(import.meta.url));
function loadFixture(name: string): string {
  return readFileSync(join(here, "fixtures", name), "utf8");
}

/** A WorkerProcess that replays fixed stdout content, chunked to test the
 * adapter's own NDJSON line-buffering across chunk boundaries. Uses
 * setTimeout, not queueMicrotask: a real child process can't produce
 * stdout before the caller even gets the WorkerProcess handle back and
 * calls onStdout() on it — a microtask can race ahead of that
 * registration, a macrotask can't (see adapter-claude/test/adapter.test.ts
 * for the failure this caused there first). */
function fakeCodexProcess(content: string, chunkSize = content.length): WorkerProcess {
  const stdoutCbs = new Set<(chunk: string) => void>();
  const exitCbs = new Set<(code: number | null) => void>();
  setTimeout(async () => {
    for (let i = 0; i < content.length; i += chunkSize) {
      const chunk = content.slice(i, i + chunkSize);
      for (const cb of stdoutCbs) cb(chunk);
      await new Promise((r) => setTimeout(r, 0));
    }
    for (const cb of exitCbs) cb(0);
  }, 0);
  return {
    onStdout: (cb) => stdoutCbs.add(cb),
    onStderr: () => undefined,
    onExit: (cb) => exitCbs.add(cb),
    write: () => undefined,
    kill: async () => undefined,
    exited: () => new Promise((resolve) => exitCbs.add((code) => resolve({ code }))),
  };
}

/** Every start() now does a `codex --version` handshake before the real
 * exec spawn — wrap a test's spawnWorker so version-check calls get a
 * trivial, realistic reply instead of the test's actual fixture content. */
function withVersionHandshake(
  execSpawn: (cmd: string[]) => WorkerProcess | Promise<WorkerProcess>,
): (cmd: string[]) => Promise<WorkerProcess> {
  return async (cmd: string[]) => {
    if (cmd.includes("--version")) return fakeCodexProcess("codex-cli 0.153.4\n");
    return execSpawn(cmd);
  };
}

describe("codex adapter — lifecycle against a real captured stream", () => {
  it("identity + capabilities are honest", () => {
    const adapter = createAdapter();
    expect(adapter.id).toBe("codex");
    expect(adapter.version).toMatch(/^\d+\.\d+\.\d+/);
    // cost: false — codex has no native $ figure, only token counts.
    expect(adapter.capabilities()).toEqual({ reasoning: true, tools: true, cost: false, steer: true });
    expect(adapter.recover).toBeUndefined();
  });

  it("start() emits schema-valid events from a chunked, split-mid-line stream", async () => {
    const content = loadFixture("tool-use.jsonl");
    const ctx = makeRecordingContext({ spawnWorker: withVersionHandshake(() => fakeCodexProcess(content, 29)) });
    const adapter = createAdapter();

    const handle = await adapter.start({ adapter: "codex", project: "/tmp", prompt: "run echo" }, ctx);
    expect(handle.sessionId).toBe(ctx.sessionId);

    await waitFor(() => ctx.events.some((e) => e.type === "tool_result"));
    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "codex.turn_complete"));

    for (const ev of ctx.events) {
      expect(EmittedEvent.safeParse(ev).success).toBe(true);
    }
    expect(ctx.events.some((e) => e.type === "tool_use")).toBe(true);
    expect(ctx.events.some((e) => e.type === "assistant")).toBe(true);
  });

  it("status() reflects process exit", async () => {
    const ctx = makeRecordingContext({
      spawnWorker: withVersionHandshake(() => fakeCodexProcess(loadFixture("trivial-text.jsonl"))),
    });
    const adapter = createAdapter();
    const handle = await adapter.start({ adapter: "codex", project: "/tmp" }, ctx);

    expect((await adapter.status(handle)).state).toBe("healthy");
    let state = "healthy";
    for (let i = 0; i < 100 && state !== "down"; i++) {
      state = (await adapter.status(handle)).state;
      if (state !== "down") await new Promise((r) => setTimeout(r, 10));
    }
    expect(state).toBe("down");
  });

  it("stop() kills the worker and clears live state", async () => {
    let killed = false;
    const ctx = makeRecordingContext({
      spawnWorker: withVersionHandshake(() => {
        const proc = fakeCodexProcess("");
        return { ...proc, kill: async () => { killed = true; } };
      }),
    });
    const adapter = createAdapter();
    const handle = await adapter.start({ adapter: "codex", project: "/tmp" }, ctx);
    await adapter.stop(handle, ctx);
    expect(killed).toBe(true);
    expect((await adapter.status(handle)).state).toBe("down");
  });

  it("steer(prompt) resumes using the captured thread_id", async () => {
    const spawnedCmds: string[][] = [];
    const ctx = makeRecordingContext({
      spawnWorker: withVersionHandshake((cmd) => {
        spawnedCmds.push(cmd);
        return fakeCodexProcess(loadFixture("trivial-text.jsonl"));
      }),
    });
    const adapter = createAdapter();
    const handle = await adapter.start({ adapter: "codex", project: "/tmp", prompt: "first" }, ctx);
    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "codex.turn_complete"));

    const ack = await adapter.steer(handle, { kind: "prompt", text: "follow up" }, ctx);
    expect(ack.ok).toBe(true);
    expect(spawnedCmds).toHaveLength(2);
    expect(spawnedCmds[1]).toContain("resume");
    expect(spawnedCmds[1]).toContain("01a0a1fe-76ee-7723-9478-911a17f22fcb"); // thread_id from the fixture
    expect(spawnedCmds[1]).not.toContain("--sandbox"); // real CLI rejects --sandbox on resume
  });

  it("steer(prompt) before any thread_id is captured is an honest no", async () => {
    const ctx = makeRecordingContext({ spawnWorker: async () => fakeCodexProcess("") });
    const adapter = createAdapter();
    const handle = await adapter.start({ adapter: "codex", project: "/tmp" }, ctx);
    const ack = await adapter.steer(handle, { kind: "prompt", text: "too soon" }, ctx);
    expect(ack.ok).toBe(false);
  });

  it("steer(resume) is an honest no, not a fake success", async () => {
    const ctx = makeRecordingContext({ spawnWorker: async () => fakeCodexProcess("") });
    const adapter = createAdapter();
    const handle = await adapter.start({ adapter: "codex", project: "/tmp" }, ctx);
    const ack = await adapter.steer(handle, { kind: "resume" }, ctx);
    expect(ack.ok).toBe(false);
  });

  it("version handshake: match is quiet, mismatch is a visible warning (never an abort)", async () => {
    const mismatchCtx = makeRecordingContext({
      spawnWorker: withVersionHandshake(() => fakeCodexProcess("")),
    });
    const mismatchAdapter = createAdapter({ expectedVersion: "9.9.9" });
    await mismatchAdapter.start({ adapter: "codex", project: "/tmp" }, mismatchCtx);
    const mismatchEvent = mismatchCtx.events.find(
      (e) => (e.payload as { kind?: string }).kind === "codex.version_handshake",
    );
    expect((mismatchEvent?.payload as { mismatch?: boolean }).mismatch).toBe(true);
    expect(mismatchEvent?.summary).toContain("version mismatch");

    const matchCtx = makeRecordingContext({
      spawnWorker: withVersionHandshake(() => fakeCodexProcess("")),
    });
    const matchAdapter = createAdapter({ expectedVersion: "0.153" });
    // Must not throw/abort even on mismatch above, and must resolve to a
    // healthy session when the version does match.
    const handle = await matchAdapter.start({ adapter: "codex", project: "/tmp" }, matchCtx);
    expect((await matchAdapter.status(handle)).state).toBe("healthy");
    const matchEvent = matchCtx.events.find((e) => (e.payload as { kind?: string }).kind === "codex.version_handshake");
    expect((matchEvent?.payload as { mismatch?: boolean }).mismatch).toBe(false);
  });

  it("an unhandled event type flips status() to degraded", async () => {
    const content = '{"type":"thread.started","thread_id":"x"}\n{"type":"some_future_type"}\n';
    const ctx = makeRecordingContext({ spawnWorker: withVersionHandshake(() => fakeCodexProcess(content)) });
    const adapter = createAdapter();
    const handle = await adapter.start({ adapter: "codex", project: "/tmp" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.summary.includes("unhandled stream-json type")));
    expect((await adapter.status(handle)).state).toBe("degraded");
  });

  it("a malformed JSON line becomes a visible system event, not a crash", async () => {
    const content = '{"type":"thread.started","thread_id":"x"}\n{not json\n';
    const ctx = makeRecordingContext({ spawnWorker: async () => fakeCodexProcess(content) });
    const adapter = createAdapter();
    await adapter.start({ adapter: "codex", project: "/tmp" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.summary.includes("non-JSON stdout line")));
  });
});
