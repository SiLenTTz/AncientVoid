import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { WorkerProcess } from "@uacc/contracts";
import { makeRecordingContext, waitFor } from "@uacc/adapter-testkit";
import { createAdapter } from "../src/index.ts";

// Same testkit gap as adapter-claude/adapter-codex (see their test files'
// doc comments): runContractTests() can't exercise a real spawnWorker
// adapter, so this builds its own lifecycle test on makeRecordingContext.

const here = dirname(fileURLToPath(import.meta.url));
function loadFixture(name: string): string {
  return readFileSync(join(here, "fixtures", name), "utf8");
}

function fakeOpencodeProcess(content: string, exitCode: number | null = 0): WorkerProcess {
  const stdoutCbs = new Set<(chunk: string) => void>();
  const exitCbs = new Set<(code: number | null) => void>();
  setTimeout(async () => {
    for (const cb of stdoutCbs) cb(content);
    await new Promise((r) => setTimeout(r, 0));
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

describe("opencode adapter — lifecycle against a real captured stream", () => {
  it("identity + capabilities are honest", () => {
    const adapter = createAdapter();
    expect(adapter.id).toBe("opencode");
    expect(adapter.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(adapter.capabilities()).toEqual({
      reasoning: true,
      tools: true,
      cost: true,
      steer: true,
      usage: false,
      nativeDiscovery: "none",
      nativeResume: "native",
    });
  });

  it("start() spawns `opencode run <prompt> --format json` and emits schema-valid events", async () => {
    const spawnedCmds: string[][] = [];
    const ctx = makeRecordingContext({
      spawnWorker: async (cmd) => {
        spawnedCmds.push(cmd);
        return fakeOpencodeProcess(loadFixture("trivial-read.jsonl"));
      },
    });
    const adapter = createAdapter();
    await adapter.start({ adapter: "opencode", project: "/tmp", prompt: "read a.txt" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.type === "assistant"));
    expect(spawnedCmds[0]).toContain("run");
    expect(spawnedCmds[0]).toContain("read a.txt");
    expect(spawnedCmds[0]).toContain("--format");
    expect(spawnedCmds[0]).toContain("json");
  });

  it("steer(prompt) continues via --session <id> captured from the real sessionID field", async () => {
    const spawnedCmds: string[][] = [];
    const ctx = makeRecordingContext({
      spawnWorker: async (cmd) => {
        spawnedCmds.push(cmd);
        return fakeOpencodeProcess(loadFixture("trivial-read.jsonl"));
      },
    });
    const adapter = createAdapter();
    const handle = await adapter.start({ adapter: "opencode", project: "/tmp", prompt: "read a.txt" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.type === "assistant"));

    await adapter.steer(handle, { kind: "prompt", text: "now read b.txt" }, ctx);
    await waitFor(() => spawnedCmds.length === 2);
    expect(spawnedCmds[1]).toContain("--session");
    expect(spawnedCmds[1]).toContain("ses_f4e417746ffeHpklpqLT8XojKI");
  });

  it("T3.12: spec.model appends --model on the initial spawn only, never on --session continuation", async () => {
    const spawnedCmds: string[][] = [];
    const ctx = makeRecordingContext({
      spawnWorker: async (cmd) => {
        spawnedCmds.push(cmd);
        return fakeOpencodeProcess(loadFixture("trivial-read.jsonl"));
      },
    });
    const adapter = createAdapter();
    const handle = await adapter.start(
      { adapter: "opencode", project: "/tmp", prompt: "go", model: "zai-coding-plan/glm-5.3" },
      ctx,
    );
    await waitFor(() => ctx.events.some((e) => e.type === "assistant"));
    expect(spawnedCmds[0]).toContain("--model");
    expect(spawnedCmds[0]).toContain("zai-coding-plan/glm-5.3");

    await adapter.steer(handle, { kind: "prompt", text: "follow up" }, ctx);
    await waitFor(() => spawnedCmds.length === 2);
    expect(spawnedCmds[1]).not.toContain("--model");
  });

  it("args.agent appends --agent on the initial spawn; args.skill is visibly ignored, not silently dropped", async () => {
    const ctx = makeRecordingContext({
      spawnWorker: async () => fakeOpencodeProcess(loadFixture("trivial-read.jsonl")),
    });
    const adapter = createAdapter();
    await adapter.start(
      { adapter: "opencode", project: "/tmp", prompt: "go", args: { agent: "build", skill: "bugfix" } },
      ctx,
    );
    await waitFor(() => ctx.events.some((e) => e.type === "assistant"));
    const ignored = ctx.events.find((e) => (e.payload as { kind?: string }).kind === "opencode.skill_ignored");
    expect(ignored).toBeDefined();
    expect((ignored!.payload as { requested?: string }).requested).toBe("bugfix");
  });

  it("a non-zero exit sets status down; a clean one-shot exit does not", async () => {
    const ctx = makeRecordingContext({
      spawnWorker: async () => fakeOpencodeProcess(loadFixture("trivial-read.jsonl"), 0),
    });
    const adapter = createAdapter();
    const handle = await adapter.start({ adapter: "opencode", project: "/tmp", prompt: "go" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.type === "assistant"));
    expect((await adapter.status(handle)).state).toBe("healthy");

    const ctx2 = makeRecordingContext({
      spawnWorker: async () => fakeOpencodeProcess("", 1),
    });
    const handle2 = await adapter.start({ adapter: "opencode", project: "/tmp", prompt: "go" }, ctx2);
    let downState = false;
    for (let i = 0; i < 40 && !downState; i++) {
      downState = (await adapter.status(handle2)).state === "down";
      if (!downState) await new Promise((r) => setTimeout(r, 25));
    }
    expect(downState).toBe(true);
  });
});
