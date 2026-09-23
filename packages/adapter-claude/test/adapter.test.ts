import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { WorkerProcess } from "@uacc/contracts";
import { EmittedEvent } from "@uacc/contracts";
import { makeRecordingContext, waitFor } from "@uacc/adapter-testkit";
import { createAdapter } from "../src/index.ts";

/**
 * `@uacc/adapter-testkit`'s `runContractTests()` cannot exercise this
 * adapter: its internal AdapterContext always throws on `spawnWorker`
 * (testkit/src/index.ts:39) with no override hook, so any adapter that
 * actually spawns a worker — as every real (non-dummy) adapter must — fails
 * the suite's very first `start()` check before its own logic runs at all.
 * Filed as a follow-up (the testkit needs a spawnWorker override option);
 * until then, real adapters build their own lifecycle test directly on
 * `makeRecordingContext({ spawnWorker: ... })`, which IS override-able.
 */

const here = dirname(fileURLToPath(import.meta.url));
function loadFixture(name: string): string {
  return readFileSync(join(here, "fixtures", name), "utf8");
}

/** A WorkerProcess that replays fixed stdout content, chunked to test the
 * adapter's own NDJSON line-buffering across chunk boundaries. */
function fakeClaudeProcess(content: string, chunkSize = content.length, exitCode: number | null = 0): WorkerProcess {
  const stdoutCbs = new Set<(chunk: string) => void>();
  const exitCbs = new Set<(code: number | null) => void>();
  // setTimeout, not queueMicrotask: a real child process can't produce
  // stdout before the caller even gets the WorkerProcess handle back and
  // calls onStdout() on it. A microtask can fire that early (it raced
  // ahead of attach()'s registration in practice) — a macrotask can't.
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

describe("claude adapter — lifecycle against a real captured stream", () => {
  it("identity + capabilities are honest", () => {
    const adapter = createAdapter();
    expect(adapter.id).toBe("claude");
    expect(adapter.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(adapter.capabilities()).toMatchObject({
      reasoning: true,
      tools: true,
      cost: true,
      steer: true,
      usage: true,
      nativeDiscovery: "none",
      nativeResume: "native",
    });
    expect(adapter.capabilities().features).toMatchObject({ followUp: true, interrupt: true, toolGate: "allowlist", skills: true, agents: true, modelChoice: "start" });
    // ADR-0018: the flag the live hub runs with means every tool runs unasked.
    expect(createAdapter({ extraArgs: ["--dangerously-skip-permissions"] }).capabilities().features.toolGate).toBe("bypass");
    expect(createAdapter({ extraArgs: ["--permission-mode", "bypassPermissions"] }).capabilities().features.toolGate).toBe("bypass");
    // ADR-0014: recover() adopts a surviving turn or resumes natively.
    expect(typeof adapter.recover).toBe("function");
  });

  it("start() emits schema-valid events from a chunked, split-mid-line stream", async () => {
    const content = loadFixture("tool-use.jsonl");
    const ctx = makeRecordingContext({ spawnWorker: async () => fakeClaudeProcess(content, 37) });
    const adapter = createAdapter();

    const handle = await adapter.start({ adapter: "claude", project: "/tmp", prompt: "run echo" }, ctx);
    expect(handle.sessionId).toBe(ctx.sessionId);

    await waitFor(() => ctx.events.some((e) => e.type === "tool_result"));
    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "claude.result"));

    for (const ev of ctx.events) {
      const parsed = EmittedEvent.safeParse(ev);
      expect(parsed.success).toBe(true);
    }
    expect(ctx.events.some((e) => e.type === "tool_use")).toBe(true);
    expect(ctx.events.some((e) => e.type === "assistant")).toBe(true);
  });

  it("BUG-0008: a clean one-shot exit (turn finished normally) stays healthy, never down", async () => {
    // claude -p is one-shot per turn — every successful turn's process
    // exits by design. Found via a real end-to-end claude run: the
    // process exiting cleanly used to unconditionally flip status() to
    // "down", so T1.9's heartbeat marked the session "error" seconds
    // after it had actually finished successfully.
    const ctx = makeRecordingContext({ spawnWorker: async () => fakeClaudeProcess(loadFixture("trivial-text.jsonl")) });
    const adapter = createAdapter();
    const handle = await adapter.start({ adapter: "claude", project: "/tmp" }, ctx);

    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "claude.result"));
    // Give the process's exit callback (fires after the same macrotask
    // queue) a chance to run before asserting nothing changed.
    await new Promise((r) => setTimeout(r, 20));
    expect((await adapter.status(handle)).state).toBe("healthy");
  });

  it("BUG-0008: an abnormal exit (nonzero code) still correctly reports down", async () => {
    const ctx = makeRecordingContext({
      spawnWorker: async () => fakeClaudeProcess(loadFixture("trivial-text.jsonl"), undefined, 1),
    });
    const adapter = createAdapter();
    const handle = await adapter.start({ adapter: "claude", project: "/tmp" }, ctx);

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
      spawnWorker: async () => {
        const proc = fakeClaudeProcess("");
        return { ...proc, kill: async () => { killed = true; } };
      },
    });
    const adapter = createAdapter();
    const handle = await adapter.start({ adapter: "claude", project: "/tmp" }, ctx);
    await adapter.stop(handle, ctx);
    expect(killed).toBe(true);
    expect((await adapter.status(handle)).state).toBe("down");
  });

  it("steer(prompt) spawns a resumed process using the captured session_id", async () => {
    const spawnedCmds: string[][] = [];
    const ctx = makeRecordingContext({
      spawnWorker: async (cmd) => {
        spawnedCmds.push(cmd);
        return fakeClaudeProcess(loadFixture("trivial-text.jsonl"));
      },
    });
    const adapter = createAdapter();
    const handle = await adapter.start({ adapter: "claude", project: "/tmp", prompt: "first" }, ctx);
    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "claude.result"));

    const ack = await adapter.steer(handle, { kind: "prompt", text: "follow up" }, ctx);
    expect(ack.ok).toBe(true);
    expect(spawnedCmds).toHaveLength(2);
    expect(spawnedCmds[1]).toContain("--resume");
    expect(spawnedCmds[1]).toContain("d154ee1b-a065-42dc-b523-c5810f077d2d"); // session_id from the fixture's system/init line
  });

  it("T1.5-10: args.skill prefixes the prompt with /skill on the initial spawn, reapplied on steer", async () => {
    const spawnedCmds: string[][] = [];
    const ctx = makeRecordingContext({
      spawnWorker: async (cmd) => {
        spawnedCmds.push(cmd);
        return fakeClaudeProcess(loadFixture("trivial-text.jsonl"));
      },
    });
    const adapter = createAdapter();
    const handle = await adapter.start(
      { adapter: "claude", project: "/tmp", prompt: "fix it", args: { skill: "bugfix" } },
      ctx,
    );
    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "claude.result"));
    expect(spawnedCmds[0]).toContain("/bugfix\n\nfix it");

    await adapter.steer(handle, { kind: "prompt", text: "follow up" }, ctx);
    // Reapplied on the resumed turn too — a skill choice is fixed for the
    // whole session, not re-selectable per turn (ADR-0005).
    expect(spawnedCmds[1]).toContain("/bugfix\n\nfollow up");
  });

  it("T1.5-10: args.agent appends --agent on the initial spawn only, never on a resume", async () => {
    const spawnedCmds: string[][] = [];
    const ctx = makeRecordingContext({
      spawnWorker: async (cmd) => {
        spawnedCmds.push(cmd);
        return fakeClaudeProcess(loadFixture("trivial-text.jsonl"));
      },
    });
    const adapter = createAdapter();
    const handle = await adapter.start(
      { adapter: "claude", project: "/tmp", prompt: "go", args: { agent: "hub-dev" } },
      ctx,
    );
    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "claude.result"));
    expect(spawnedCmds[0]).toContain("--agent");
    expect(spawnedCmds[0]).toContain("hub-dev");

    await adapter.steer(handle, { kind: "prompt", text: "follow up" }, ctx);
    // ADR-0005: whether --agent still does anything on --resume is
    // unverified, so it's deliberately never re-added.
    expect(spawnedCmds[1]).not.toContain("--agent");
  });

  it("T1.6-6: spec.model appends --model on the initial spawn only, never on a resume", async () => {
    const spawnedCmds: string[][] = [];
    const ctx = makeRecordingContext({
      spawnWorker: async (cmd) => {
        spawnedCmds.push(cmd);
        return fakeClaudeProcess(loadFixture("trivial-text.jsonl"));
      },
    });
    const adapter = createAdapter();
    const handle = await adapter.start({ adapter: "claude", project: "/tmp", prompt: "go", model: "opus" }, ctx);
    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "claude.result"));
    expect(spawnedCmds[0]).toContain("--model");
    expect(spawnedCmds[0]).toContain("opus");

    await adapter.steer(handle, { kind: "prompt", text: "follow up" }, ctx);
    // Same reasoning as --agent: a resumed process already has its model
    // fixed, never re-added on --resume.
    expect(spawnedCmds[1]).not.toContain("--model");
  });

  it("steer(resume) is an honest no, not a fake success", async () => {
    const ctx = makeRecordingContext({ spawnWorker: async () => fakeClaudeProcess("") });
    const adapter = createAdapter();
    const handle = await adapter.start({ adapter: "claude", project: "/tmp" }, ctx);
    const ack = await adapter.steer(handle, { kind: "resume" }, ctx);
    expect(ack.ok).toBe(false);
  });

  it("a malformed JSON line becomes a visible system event, not a crash", async () => {
    const content = '{"type":"system","subtype":"init","cwd":"/tmp","session_id":"x"}\n{not json\n';
    const ctx = makeRecordingContext({ spawnWorker: async () => fakeClaudeProcess(content) });
    const adapter = createAdapter();
    await adapter.start({ adapter: "claude", project: "/tmp" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.summary.includes("non-JSON stdout line")));
  });

  it("ADR-0014: recover() without a surviving worker resumes the recorded session on the next prompt", async () => {
    const adapter = createAdapter();
    expect(await adapter.recover!("s1", 0, makeRecordingContext({ adoptWorker: async () => null, nativeSessionId: null }))).toBeNull();
    const spawned: string[][] = [];
    const ctx = makeRecordingContext({
      adoptWorker: async () => null,
      nativeSessionId: "native-1",
      spawnWorker: async (cmd) => {
        spawned.push(cmd);
        return fakeClaudeProcess("");
      },
    });
    const handle = await adapter.recover!("s1", 0, ctx);
    expect(handle).toEqual({ sessionId: "s1" });
    expect((await adapter.steer(handle!, { kind: "prompt", text: "weiter" }, ctx)).ok).toBe(true);
    expect(spawned[0]).toEqual(expect.arrayContaining(["--resume", "native-1"]));
  });
});
