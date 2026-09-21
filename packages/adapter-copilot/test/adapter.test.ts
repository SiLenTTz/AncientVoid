import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { WorkerProcess } from "@uacc/contracts";
import { makeRecordingContext, waitFor } from "@uacc/adapter-testkit";
import { createAdapter } from "../src/index.ts";

// Same testkit gap as adapter-claude/adapter-codex/adapter-opencode (see
// their test files' doc comments): runContractTests() can't exercise a
// real spawnWorker adapter, so this builds its own lifecycle test on
// makeRecordingContext.

const here = dirname(fileURLToPath(import.meta.url));
function loadFixture(name: string): string {
  return readFileSync(join(here, "fixtures", name), "utf8");
}

function fakeCopilotProcess(content: string, exitCode: number | null = 0, stderr = ""): WorkerProcess {
  const stdoutCbs = new Set<(chunk: string) => void>();
  const stderrCbs = new Set<(chunk: string) => void>();
  const exitCbs = new Set<(code: number | null) => void>();
  setTimeout(async () => {
    for (const cb of stdoutCbs) cb(content);
    if (stderr) for (const cb of stderrCbs) cb(stderr);
    await new Promise((r) => setTimeout(r, 0));
    for (const cb of exitCbs) cb(exitCode);
  }, 0);
  return {
    onStdout: (cb) => stdoutCbs.add(cb),
    onStderr: (cb) => stderrCbs.add(cb),
    onExit: (cb) => exitCbs.add(cb),
    write: () => undefined,
    kill: async () => undefined,
    exited: () => new Promise((resolve) => exitCbs.add((code) => resolve({ code }))),
  };
}

describe("copilot adapter — lifecycle against real captured streams", () => {
  it("identity + capabilities are honest", () => {
    const adapter = createAdapter();
    expect(adapter.id).toBe("copilot");
    expect(adapter.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(adapter.capabilities()).toEqual({
      reasoning: false,
      tools: true,
      cost: false,
      steer: true,
      usage: false,
      nativeDiscovery: "none",
      nativeResume: "native",
    });
  });

  it("start() spawns `copilot -p <prompt> --output-format json --allow-all-tools` and emits schema-valid events", async () => {
    const spawnedCmds: string[][] = [];
    const ctx = makeRecordingContext({
      spawnWorker: async (cmd) => {
        spawnedCmds.push(cmd);
        return fakeCopilotProcess(loadFixture("trivial-say-ok.jsonl"));
      },
    });
    const adapter = createAdapter();
    await adapter.start({ adapter: "copilot", project: "/tmp", prompt: "say ok" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.type === "assistant"));
    expect(spawnedCmds[0]).toContain("-p");
    expect(spawnedCmds[0]).toContain("say ok");
    expect(spawnedCmds[0]).toContain("--output-format");
    expect(spawnedCmds[0]).toContain("json");
    expect(spawnedCmds[0]).toContain("--allow-all-tools");
  });

  it("steer(prompt) continues via -r <id> captured from the real terminal result line's sessionId", async () => {
    const spawnedCmds: string[][] = [];
    const ctx = makeRecordingContext({
      spawnWorker: async (cmd) => {
        spawnedCmds.push(cmd);
        return fakeCopilotProcess(loadFixture("trivial-say-ok.jsonl"));
      },
    });
    const adapter = createAdapter();
    const handle = await adapter.start({ adapter: "copilot", project: "/tmp", prompt: "say ok" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.type === "assistant"));

    await adapter.steer(handle, { kind: "prompt", text: "say ok again" }, ctx);
    await waitFor(() => spawnedCmds.length === 2);
    expect(spawnedCmds[1]).toContain("-r");
    expect(spawnedCmds[1]).toContain("b3be68a2-79a7-494a-b9a3-f328f2aa712b");
  });

  it("T3.4: spec.model appends --model on the initial spawn only, never on -r continuation", async () => {
    const spawnedCmds: string[][] = [];
    const ctx = makeRecordingContext({
      spawnWorker: async (cmd) => {
        spawnedCmds.push(cmd);
        return fakeCopilotProcess(loadFixture("trivial-say-ok.jsonl"));
      },
    });
    const adapter = createAdapter();
    const handle = await adapter.start({ adapter: "copilot", project: "/tmp", prompt: "go", model: "gpt-5.1" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.type === "assistant"));
    expect(spawnedCmds[0]).toContain("--model");
    expect(spawnedCmds[0]).toContain("gpt-5.1");

    await adapter.steer(handle, { kind: "prompt", text: "follow up" }, ctx);
    await waitFor(() => spawnedCmds.length === 2);
    expect(spawnedCmds[1]).not.toContain("--model");
  });

  it("args.agent appends --agent on the initial spawn", async () => {
    const spawnedCmds: string[][] = [];
    const ctx = makeRecordingContext({
      spawnWorker: async (cmd) => {
        spawnedCmds.push(cmd);
        return fakeCopilotProcess(loadFixture("trivial-say-ok.jsonl"));
      },
    });
    const adapter = createAdapter();
    await adapter.start({ adapter: "copilot", project: "/tmp", prompt: "go", args: { agent: "build" } }, ctx);
    await waitFor(() => ctx.events.some((e) => e.type === "assistant"));
    expect(spawnedCmds[0]).toContain("--agent");
    expect(spawnedCmds[0]).toContain("build");
  });

  it("a real stderr line (e.g. an unknown --model) surfaces as a visible system event", async () => {
    const ctx = makeRecordingContext({
      spawnWorker: async () =>
        fakeCopilotProcess("", 1, 'Error: Model "does-not-exist" from --model flag is not available.'),
    });
    const adapter = createAdapter();
    await adapter.start({ adapter: "copilot", project: "/tmp", prompt: "go", model: "does-not-exist" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.type === "system" && e.summary.includes("stderr")));
    const stderrEvent = ctx.events.find((e) => e.type === "system" && e.summary.includes("stderr"));
    expect(stderrEvent!.summary).toContain("not available");
  });

  it("a non-zero exit sets status down; a clean one-shot exit does not", async () => {
    const ctx = makeRecordingContext({
      spawnWorker: async () => fakeCopilotProcess(loadFixture("trivial-say-ok.jsonl"), 0),
    });
    const adapter = createAdapter();
    const handle = await adapter.start({ adapter: "copilot", project: "/tmp", prompt: "go" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.type === "assistant"));
    expect((await adapter.status(handle)).state).toBe("healthy");

    const ctx2 = makeRecordingContext({
      spawnWorker: async () => fakeCopilotProcess("", 1),
    });
    const handle2 = await adapter.start({ adapter: "copilot", project: "/tmp", prompt: "go" }, ctx2);
    let downState = false;
    for (let i = 0; i < 40 && !downState; i++) {
      downState = (await adapter.status(handle2)).state === "down";
      if (!downState) await new Promise((r) => setTimeout(r, 25));
    }
    expect(downState).toBe(true);
  });
});
