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
function fakeCodexProcess(content: string, chunkSize = content.length, exitCode: number | null = 0): WorkerProcess {
  const stdoutCbs = new Set<(chunk: string) => void>();
  const exitCbs = new Set<(code: number | null) => void>();
  setTimeout(async () => {
    for (let i = 0; i < content.length; i += chunkSize) {
      const chunk = content.slice(i, i + chunkSize);
      for (const cb of stdoutCbs) cb(chunk);
      await new Promise((r) => setTimeout(r, 0));
    }
    for (const cb of exitCbs) cb(exitCode);
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
    const adapter = createAdapter({ mode: "exec" });
    expect(adapter.id).toBe("codex");
    expect(adapter.version).toMatch(/^\d+\.\d+\.\d+/);
    // cost: true (T1.11) — codex has no native $ figure, but pricing.ts
    // estimates one from token counts when a priced model was requested.
    expect(adapter.capabilities()).toMatchObject({
      reasoning: true,
      tools: true,
      cost: true,
      steer: true,
      usage: false,
      nativeDiscovery: "none",
      nativeResume: "native",
    });
    expect(adapter.capabilities().features).toMatchObject({ followUp: true, toolGate: "sandbox", questions: false });
    expect(createAdapter({ mode: "exec", sandbox: "danger-full-access" }).capabilities().features.toolGate).toBe("bypass");
    expect(typeof adapter.recover).toBe("function"); // ADR-0014
  });

  it("start() emits schema-valid events from a chunked, split-mid-line stream", async () => {
    const content = loadFixture("tool-use.jsonl");
    const ctx = makeRecordingContext({ spawnWorker: withVersionHandshake(() => fakeCodexProcess(content, 29)) });
    const adapter = createAdapter({ mode: "exec" });

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

  it("BUG-0008: a clean one-shot exit (turn finished normally) stays healthy, never down", async () => {
    // codex exec is one-shot per turn — every successful turn's process
    // exits by design. Found via a real end-to-end codex run: the process
    // exiting cleanly used to unconditionally flip status() to "down", so
    // T1.9's heartbeat marked the session "error" seconds after it had
    // actually finished successfully.
    const ctx = makeRecordingContext({
      spawnWorker: withVersionHandshake(() => fakeCodexProcess(loadFixture("trivial-text.jsonl"))),
    });
    const adapter = createAdapter({ mode: "exec" });
    const handle = await adapter.start({ adapter: "codex", project: "/tmp" }, ctx);

    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "codex.turn_complete"));
    await new Promise((r) => setTimeout(r, 20));
    expect((await adapter.status(handle)).state).toBe("healthy");
  });

  it("BUG-0008: an abnormal exit (nonzero code) still correctly reports down", async () => {
    const ctx = makeRecordingContext({
      spawnWorker: withVersionHandshake(() => fakeCodexProcess(loadFixture("trivial-text.jsonl"), undefined, 1)),
    });
    const adapter = createAdapter({ mode: "exec" });
    const handle = await adapter.start({ adapter: "codex", project: "/tmp" }, ctx);

    let state = "healthy";
    for (let i = 0; i < 100 && state !== "down"; i++) {
      state = (await adapter.status(handle)).state;
      if (state !== "down") await new Promise((r) => setTimeout(r, 10));
    }
    expect(state).toBe("down");
  });

  it("BUG-0008: an abnormal exit still reports down even if the session was earlier flagged degraded", async () => {
    // Before the fix, `degraded` was checked ahead of `healthy` in
    // status(), so a session that ever saw one unhandled event type would
    // report "degraded" forever — masking a later real crash completely,
    // and making it invisible to the heartbeat (which only acts on
    // down/broken, never degraded).
    const content =
      '{"type":"thread.started","thread_id":"x"}\n{"type":"some_future_type"}\n';
    const ctx = makeRecordingContext({
      spawnWorker: withVersionHandshake(() => fakeCodexProcess(content, undefined, 1)),
    });
    const adapter = createAdapter({ mode: "exec" });
    const handle = await adapter.start({ adapter: "codex", project: "/tmp" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.summary.includes("unhandled stream-json type")));
    // The degraded flag and the abnormal exit both land within the same
    // couple of ticks here (tiny fixture, no real I/O) — too close to
    // assert an interim "degraded" without a race. The point of this test
    // is the end state: once the process has actually exited abnormally,
    // status() must report "down", never stuck on "degraded" forever.
    let state = "unknown";
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
    const adapter = createAdapter({ mode: "exec" });
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
    const adapter = createAdapter({ mode: "exec" });
    const handle = await adapter.start({ adapter: "codex", project: "/tmp", prompt: "first" }, ctx);
    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "codex.turn_complete"));

    const ack = await adapter.steer(handle, { kind: "prompt", text: "follow up" }, ctx);
    expect(ack.ok).toBe(true);
    expect(spawnedCmds).toHaveLength(2);
    expect(spawnedCmds[1]).toContain("resume");
    expect(spawnedCmds[1]).toContain("01a0a1fe-76ee-7723-9478-911a17f22fcb"); // thread_id from the fixture
    expect(spawnedCmds[1]).not.toContain("--sandbox"); // real CLI rejects --sandbox on resume
  });

  it("T1.11: spec.model reaches the CLI as --model, on both the initial spawn and resume", async () => {
    const spawnedCmds: string[][] = [];
    const ctx = makeRecordingContext({
      spawnWorker: withVersionHandshake((cmd) => {
        spawnedCmds.push(cmd);
        return fakeCodexProcess(loadFixture("trivial-text.jsonl"));
      }),
    });
    const adapter = createAdapter({ mode: "exec" });
    const handle = await adapter.start(
      { adapter: "codex", project: "/tmp", prompt: "first", model: "gpt-5.3-codex" },
      ctx,
    );
    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "codex.turn_complete"));
    expect(spawnedCmds[0]).toContain("--model");
    expect(spawnedCmds[0]).toContain("gpt-5.3-codex");

    // costUsd on the initial turn's event, from the requested model.
    const firstTurn = ctx.events.find((e) => (e.payload as { kind?: string }).kind === "codex.turn_complete");
    expect(firstTurn?.costUsd).toBeGreaterThan(0);

    await adapter.steer(handle, { kind: "prompt", text: "follow up" }, ctx);
    expect(spawnedCmds[1]).toContain("--model");
    expect(spawnedCmds[1]).toContain("gpt-5.3-codex");
  });

  it("T1.11: no spec.model means no --model flag and no costUsd (R9.7 — unbekannt statt geraten)", async () => {
    const spawnedCmds: string[][] = [];
    const ctx = makeRecordingContext({
      spawnWorker: withVersionHandshake((cmd) => {
        spawnedCmds.push(cmd);
        return fakeCodexProcess(loadFixture("trivial-text.jsonl"));
      }),
    });
    const adapter = createAdapter({ mode: "exec" });
    await adapter.start({ adapter: "codex", project: "/tmp", prompt: "first" }, ctx);
    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "codex.turn_complete"));
    expect(spawnedCmds[0]).not.toContain("--model");
    const turn = ctx.events.find((e) => (e.payload as { kind?: string }).kind === "codex.turn_complete");
    expect(turn?.costUsd).toBeUndefined();
  });

  it("T1.5-10/ADR-0005: a requested skill/agent is visibly ignored, never silently swallowed", async () => {
    const ctx = makeRecordingContext({
      spawnWorker: withVersionHandshake(() => fakeCodexProcess(loadFixture("trivial-text.jsonl"))),
    });
    const adapter = createAdapter({ mode: "exec" });
    await adapter.start(
      { adapter: "codex", project: "/tmp", prompt: "first", args: { skill: "bugfix" } },
      ctx,
    );
    await waitFor(() => ctx.events.some((e) => e.summary.includes("skill/agent selection ignored")));
    const ignored = ctx.events.find((e) => e.summary.includes("skill/agent selection ignored"));
    expect(ignored?.type).toBe("system");
    expect((ignored?.payload as { requested?: unknown }).requested).toEqual({ skill: "bugfix" });
  });

  it("a hub-resolved skillChain is not reported as ignored", async () => {
    const ctx = makeRecordingContext({
      spawnWorker: withVersionHandshake((cmd) => {
        expect(cmd.join(" ")).toContain("first");
        return fakeCodexProcess(loadFixture("trivial-text.jsonl"));
      }),
    });
    const adapter = createAdapter({ mode: "exec" });
    await adapter.start(
      { adapter: "codex", project: "/tmp", prompt: "first", args: { skill: "neon", skillChain: ["task", "neon"] } },
      ctx,
    );
    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "codex.turn_complete"));
    expect(ctx.events.some((e) => e.summary.includes("skill/agent selection ignored"))).toBe(false);
  });

  it("steer(prompt) before any thread_id is captured is an honest no", async () => {
    const ctx = makeRecordingContext({ spawnWorker: async () => fakeCodexProcess("") });
    const adapter = createAdapter({ mode: "exec" });
    const handle = await adapter.start({ adapter: "codex", project: "/tmp" }, ctx);
    const ack = await adapter.steer(handle, { kind: "prompt", text: "too soon" }, ctx);
    expect(ack.ok).toBe(false);
  });

  it("steer(resume) is an honest no, not a fake success", async () => {
    const ctx = makeRecordingContext({ spawnWorker: async () => fakeCodexProcess("") });
    const adapter = createAdapter({ mode: "exec" });
    const handle = await adapter.start({ adapter: "codex", project: "/tmp" }, ctx);
    const ack = await adapter.steer(handle, { kind: "resume" }, ctx);
    expect(ack.ok).toBe(false);
  });

  it("version handshake: match is quiet, mismatch is a visible warning (never an abort)", async () => {
    const mismatchCtx = makeRecordingContext({
      spawnWorker: withVersionHandshake(() => fakeCodexProcess("")),
    });
    const mismatchAdapter = createAdapter({ mode: "exec", expectedVersion: "9.9.9" });
    await mismatchAdapter.start({ adapter: "codex", project: "/tmp" }, mismatchCtx);
    const mismatchEvent = mismatchCtx.events.find(
      (e) => (e.payload as { kind?: string }).kind === "codex.version_handshake",
    );
    expect((mismatchEvent?.payload as { mismatch?: boolean }).mismatch).toBe(true);
    expect(mismatchEvent?.summary).toContain("version mismatch");

    const matchCtx = makeRecordingContext({
      spawnWorker: withVersionHandshake(() => fakeCodexProcess("")),
    });
    const matchAdapter = createAdapter({ mode: "exec", expectedVersion: "0.153" });
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
    const adapter = createAdapter({ mode: "exec" });
    const handle = await adapter.start({ adapter: "codex", project: "/tmp" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.summary.includes("unhandled stream-json type")));
    expect((await adapter.status(handle)).state).toBe("degraded");
  });

  it("a malformed JSON line becomes a visible system event, not a crash", async () => {
    const content = '{"type":"thread.started","thread_id":"x"}\n{not json\n';
    const ctx = makeRecordingContext({ spawnWorker: async () => fakeCodexProcess(content) });
    const adapter = createAdapter({ mode: "exec" });
    await adapter.start({ adapter: "codex", project: "/tmp" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.summary.includes("non-JSON stdout line")));
  });

  it("ADR-0014: recover() without a surviving worker resumes the recorded thread on the next prompt", async () => {
    const adapter = createAdapter({ mode: "exec" });
    expect(await adapter.recover!("s1", 0, makeRecordingContext({ adoptWorker: async () => null, nativeSessionId: null }))).toBeNull();
    const spawned: string[][] = [];
    const ctx = makeRecordingContext({
      adoptWorker: async () => null,
      nativeSessionId: "thread-1",
      spawnWorker: withVersionHandshake((cmd) => {
        spawned.push(cmd);
        return fakeCodexProcess("");
      }),
    });
    const handle = await adapter.recover!("s1", 0, ctx);
    expect(handle).toEqual({ sessionId: "s1" });
    expect((await adapter.steer(handle!, { kind: "prompt", text: "weiter" }, ctx)).ok).toBe(true);
    expect(spawned.at(-1)).toEqual(expect.arrayContaining(["resume", "thread-1"]));
  });
});
