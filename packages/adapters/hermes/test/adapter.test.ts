import { describe, it, expect } from "vitest";
import type { WorkerProcess } from "@uacc/contracts";
import { makeRecordingContext, waitFor } from "@uacc/adapter-testkit";
import { createAdapter, extractSessionId, splitModelSpec, buildHermesArgs } from "../src/index.ts";

// Same testkit gap as adapter-aider (see its test file's doc comment):
// runContractTests() can't exercise a real spawnWorker adapter — so this
// builds its lifecycle tests on makeRecordingContext, mirroring the live
// CLI contract verified 2026-10-03 (see src/index.ts doc comment):
// stdout = answer, stderr carries `session_id: <sid>`, --resume continues.

function fakeHermesProcess(
  stdout: string,
  stderr = "",
  exitCode: number | null = 0,
  /** Split stderr into N arbitrary chunks to model tmux runner chunking. */
  stderrChunks = 1,
): WorkerProcess {
  const stdoutCbs = new Set<(chunk: string) => void>();
  const stderrCbs = new Set<(chunk: string) => void>();
  const exitCbs = new Set<(code: number | null) => void>();
  setTimeout(async () => {
    for (const cb of stdoutCbs) cb(stdout);
    const size = Math.max(1, Math.ceil(stderr.length / stderrChunks));
    for (let i = 0; i < stderr.length; i += size) {
      for (const cb of stderrCbs) cb(stderr.slice(i, i + size));
    }
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

// The literal stderr captured from the real binary (2026-10-03):
// leading blank line, then `session_id: <sid>`.
const REAL_STDERR = "\nsession_id: 20261003_202145_0ee92a";

// The literal stdout captured from the REAL tmux-PTY run through the hub
// (2026-10-03, session 20261003_203423_1d2848): ANSI terminal queries,
// CRLF endings, session_id trailer merged into stdout by the pane.
const REAL_PTY_STDOUT = "\x1b]11;?\x1b\\\x1b[cSMOKE1\r\n\r\nsession_id: 20261003_203423_1d2848\r\n";

describe("hermes adapter — parsing units", () => {
  it("extractSessionId finds the id in the real stderr shape (leading blank line)", () => {
    expect(extractSessionId(REAL_STDERR)).toBe("20261003_202145_0ee92a");
  });

  it("extractSessionId picks the LAST match when stderr repeats (resume re-prints it)", () => {
    expect(extractSessionId("noise\nsession_id: aaa\nsession_id: bbb")).toBe("bbb");
  });

  it("extractSessionId returns null for plain warnings/noise", () => {
    expect(extractSessionId("Warning: Unknown toolsets: a2a")).toBeNull();
  });

  it("splitModelSpec handles model, model:provider, :provider", () => {
    expect(splitModelSpec("glm-5.3")).toEqual({ model: "glm-5.3" });
    expect(splitModelSpec("glm-5.3:zai")).toEqual({ model: "glm-5.3", provider: "zai" });
    expect(splitModelSpec(":zai")).toEqual({ model: undefined, provider: "zai" });
  });

  it("buildHermesArgs: fresh turn vs resume turn, with and without model", () => {
    expect(buildHermesArgs("go", {})).toEqual(["chat", "-q", "go", "--yolo", "-Q", "--pass-session-id"]);
    expect(buildHermesArgs("go", { nativeSessionId: "SID" })).toEqual([
      "chat", "-q", "go", "--yolo", "-Q", "--pass-session-id", "--resume", "SID",
    ]);
    expect(buildHermesArgs("go", { model: "m", provider: "p", extraArgs: ["-v"] })).toEqual([
      "chat", "-q", "go", "--yolo", "-Q", "--pass-session-id", "-m", "m", "--provider", "p", "-v",
    ]);
  });
});

describe("hermes adapter — lifecycle against the live-verified CLI shape", () => {
  it("identity + capabilities are honest (nativeResume verified live)", () => {
    const adapter = createAdapter();
    expect(adapter.id).toBe("hermes");
    expect(adapter.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(adapter.capabilities()).toMatchObject({
      reasoning: false,
      tools: true,
      cost: false,
      steer: true,
      usage: false,
      nativeDiscovery: "none",
      nativeResume: "native",
    });
    expect(adapter.capabilities().features).toMatchObject({ followUp: true, interrupt: true, toolGate: "bypass" });
  });

  it("start() spawns `hermes chat -q <prompt> --yolo -Q --pass-session-id` and emits the stdout blob as one assistant event", async () => {
    const spawnedCmds: string[][] = [];
    const ctx = makeRecordingContext({
      spawnWorker: async (cmd) => {
        spawnedCmds.push(cmd);
        return fakeHermesProcess("OK\n", REAL_STDERR);
      },
    });
    const adapter = createAdapter();
    await adapter.start({ adapter: "hermes", project: "/tmp", prompt: "say ok" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.type === "assistant"));
    expect(spawnedCmds[0]).toEqual(["hermes", "chat", "-q", "say ok", "--yolo", "-Q", "--pass-session-id"]);
    const assistantEvents = ctx.events.filter((e) => e.type === "assistant");
    expect(assistantEvents).toHaveLength(1);
    expect((assistantEvents[0]!.payload as { text?: string }).text).toBe("OK");
  });

  it("session_id parsed from STDERR becomes a hermes.native_session system event (not assumed on stdout)", async () => {
    const ctx = makeRecordingContext({
      spawnWorker: async () => fakeHermesProcess("OK", REAL_STDERR),
    });
    const adapter = createAdapter();
    const handle = await adapter.start({ adapter: "hermes", project: "/tmp", prompt: "go" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.type === "assistant"));
    const native = ctx.events.find((e) => (e.payload as { kind?: string }).kind === "hermes.native_session");
    expect(native?.payload).toMatchObject({ nativeSessionId: "20261003_202145_0ee92a" });
    // NOTE: unlike adoption, handle.meta can NOT carry the id yet — it
    // arrives on stderr asynchronously after start() returns; the hub
    // persists it via the hermes.native_session event (same as claude).
    // The follow-up steer test proves the adapter actually uses it.
    void handle;
  });

  it("session_id survives arbitrary stderr chunking (tmux runner splits output) — T13.2", async () => {
    const ctx = makeRecordingContext({
      spawnWorker: async () => fakeHermesProcess("OK", REAL_STDERR, 0, 5),
    });
    const adapter = createAdapter();
    await adapter.start({ adapter: "hermes", project: "/tmp", prompt: "go" }, ctx);
    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "hermes.native_session"));
    const native = ctx.events.find((e) => (e.payload as { kind?: string }).kind === "hermes.native_session");
    expect(native?.payload).toMatchObject({ nativeSessionId: "20261003_202145_0ee92a" });
  });

  it("a session_id in the FINAL stderr chunk without trailing newline is still captured (exit flush)", async () => {
    const ctx = makeRecordingContext({
      spawnWorker: async () => fakeHermesProcess("OK", "\nsession_id: 20261003_noeol", 0, 3),
    });
    const adapter = createAdapter();
    await adapter.start({ adapter: "hermes", project: "/tmp", prompt: "go" }, ctx);
    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "hermes.native_session"));
    const native = ctx.events.find((e) => (e.payload as { kind?: string }).kind === "hermes.native_session");
    expect(native?.payload).toMatchObject({ nativeSessionId: "20261003_noeol" });
  });

  it("the same session_id re-printed on resume does NOT duplicate the native_session event", async () => {
    const ctx = makeRecordingContext({
      spawnWorker: async () => fakeHermesProcess("ok", REAL_STDERR),
    });
    const adapter = createAdapter();
    const handle = await adapter.start({ adapter: "hermes", project: "/tmp", prompt: "first" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.type === "assistant"));
    await adapter.steer(handle, { kind: "prompt", text: "second" }, ctx);
    await waitFor(() => ctx.events.filter((e) => e.type === "assistant").length >= 2);
    const nativeEvents = ctx.events.filter((e) => (e.payload as { kind?: string }).kind === "hermes.native_session");
    expect(nativeEvents).toHaveLength(1);
  });

  it("steer(prompt) spawns a fresh process with --resume <sid> — the live-verified continuation", async () => {
    const spawnedCmds: string[][] = [];
    const ctx = makeRecordingContext({
      spawnWorker: async (cmd) => {
        spawnedCmds.push(cmd);
        return fakeHermesProcess("turn 1", REAL_STDERR);
      },
    });
    const adapter = createAdapter();
    const handle = await adapter.start({ adapter: "hermes", project: "/tmp", prompt: "first" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.type === "assistant"));

    const ack = await adapter.steer(handle, { kind: "prompt", text: "second" }, ctx);
    expect(ack.ok).toBe(true);
    await waitFor(() => ctx.events.filter((e) => e.type === "assistant").length >= 2);
    expect(spawnedCmds[1]).toEqual([
      "hermes", "chat", "-q", "second", "--yolo", "-Q", "--pass-session-id",
      "--resume", "20261003_202145_0ee92a",
    ]);
  });

  it("spec.model 'glm-5.3:zai' maps to -m/--provider flags; absent model adds no flags", async () => {
    const spawnedCmds: string[][] = [];
    const ctx = makeRecordingContext({
      spawnWorker: async (cmd) => {
        spawnedCmds.push(cmd);
        return fakeHermesProcess("ok", REAL_STDERR);
      },
    });
    const adapter = createAdapter();
    await adapter.start({ adapter: "hermes", project: "/tmp", prompt: "go", model: "glm-5.3:zai" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.type === "assistant"));
    expect(spawnedCmds[0]).toContain("-m");
    expect(spawnedCmds[0]).toContain("glm-5.3");
    expect(spawnedCmds[0]).toContain("--provider");
    expect(spawnedCmds[0]).toContain("zai");
    expect(spawnedCmds[0]).not.toContain("--resume");
  });

  it("adoptNativeSessionId: first prompt resumes the adopted hermes session", async () => {
    const spawnedCmds: string[][] = [];
    const ctx = makeRecordingContext({
      spawnWorker: async (cmd) => {
        spawnedCmds.push(cmd);
        return fakeHermesProcess("adopted", REAL_STDERR);
      },
    });
    const adapter = createAdapter();
    await adapter.start(
      { adapter: "hermes", project: "/tmp", prompt: "hello", adoptNativeSessionId: "20261001_000000_adopted" },
      ctx,
    );
    await waitFor(() => ctx.events.some((e) => e.type === "assistant"));
    expect(spawnedCmds[0]).toContain("--resume");
    expect(spawnedCmds[0]).toContain("20261001_000000_adopted");
  });

  it("a clean one-shot exit (code 0) leaves the session healthy — claude BUG-0008 lesson", async () => {
    const ctx = makeRecordingContext({
      spawnWorker: async () => fakeHermesProcess("ok", REAL_STDERR, 0),
    });
    const adapter = createAdapter();
    const handle = await adapter.start({ adapter: "hermes", project: "/tmp", prompt: "go" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.type === "assistant"));
    expect((await adapter.status(handle)).state).toBe("healthy");
  });

  it("a non-zero exit marks the session down and emits a system event", async () => {
    const ctx = makeRecordingContext({
      spawnWorker: async () => fakeHermesProcess("", "", 1),
    });
    const adapter = createAdapter();
    const handle = await adapter.start({ adapter: "hermes", project: "/tmp", prompt: "go" }, ctx);
    let downState = false;
    for (let i = 0; i < 40 && !downState; i++) {
      downState = (await adapter.status(handle)).state === "down";
      if (!downState) await new Promise((r) => setTimeout(r, 25));
    }
    expect(downState).toBe(true);
    expect(ctx.events.some((e) => e.type === "system" && /exited with code 1/.test(e.summary))).toBe(true);
  });

  it("stdout `Warning:` lines are stripped from the answer and logged, not emitted (T13.3, live-verified od -c shape)", async () => {
    const ctx = makeRecordingContext({
      spawnWorker: async () => fakeHermesProcess("Warning: Unknown toolsets: a2a\nOK\n", REAL_STDERR),
    });
    const adapter = createAdapter();
    await adapter.start({ adapter: "hermes", project: "/tmp", prompt: "say ok" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.type === "assistant"));
    const assistantEvents = ctx.events.filter((e) => e.type === "assistant");
    expect(assistantEvents).toHaveLength(1);
    expect((assistantEvents[0]!.payload as { text?: string }).text).toBe("OK");
    // the warning must NOT surface as any event
    expect(ctx.events.some((e) => /Unknown toolsets/.test(e.summary ?? ""))).toBe(false);
  });

  it("REAL tmux-PTY stdout: ANSI noise stripped, session_id event emitted, clean answer (T13.4 live capture)", async () => {
    const ctx = makeRecordingContext({
      spawnWorker: async () => fakeHermesProcess(REAL_PTY_STDOUT, ""),
    });
    const adapter = createAdapter();
    await adapter.start({ adapter: "hermes", project: "/tmp", prompt: "say smoke" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.type === "assistant"));
    const native = ctx.events.find((e) => (e.payload as { kind?: string }).kind === "hermes.native_session");
    expect(native?.payload).toMatchObject({ nativeSessionId: "20261003_203423_1d2848" });
    const assistant = ctx.events.find((e) => e.type === "assistant");
    expect((assistant!.payload as { text?: string }).text).toBe("SMOKE1");
    // no ANSI escape may survive into the emitted answer
    expect((assistant!.payload as { text?: string }).text).not.toMatch(/\x1b|\r/);
  });

  it("PTY chunk split mid-ANSI-sequence still yields a clean answer and session_id", async () => {
    const ctx = makeRecordingContext({
      spawnWorker: async () => fakeHermesProcess(REAL_PTY_STDOUT, "", 0, 7),
    });
    const adapter = createAdapter();
    await adapter.start({ adapter: "hermes", project: "/tmp", prompt: "say smoke" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.type === "assistant"));
    const native = ctx.events.find((e) => (e.payload as { kind?: string }).kind === "hermes.native_session");
    expect(native?.payload).toMatchObject({ nativeSessionId: "20261003_203423_1d2848" });
    const assistant = ctx.events.find((e) => e.type === "assistant");
    expect((assistant!.payload as { text?: string }).text).toBe("SMOKE1");
  });

  it("a config: command + extraArgs are respected", async () => {
    const spawnedCmds: string[][] = [];
    const ctx = makeRecordingContext({
      spawnWorker: async (cmd) => {
        spawnedCmds.push(cmd);
        return fakeHermesProcess("ok");
      },
    });
    const adapter = createAdapter({ command: "/opt/hermes/bin/hermes", extraArgs: ["-v"] });
    await adapter.start({ adapter: "hermes", project: "/tmp", prompt: "go" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.type === "assistant"));
    expect(spawnedCmds[0]![0]).toBe("/opt/hermes/bin/hermes");
    expect(spawnedCmds[0]!.at(-1)).toBe("-v");
  });
});
