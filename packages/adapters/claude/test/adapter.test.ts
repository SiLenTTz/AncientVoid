import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { WorkerProcess } from "@ancientvoid/contracts";
import { EmittedEvent } from "@ancientvoid/contracts";
import { makeRecordingContext, waitFor } from "@ancientvoid/adapter-testkit";
import { createAdapter } from "../src/index.ts";

/**
 * `@ancientvoid/adapter-testkit`'s `runContractTests()` cannot exercise this
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

/** ADR-0098: the streaming-input claude process — stays alive across turn
 * ends, records stdin writes, and lets the test drive stdout/exit by hand. */
function fakeStreamingClaude(): WorkerProcess & { writes: string[]; pushLines: (lines: string) => void; exitWith: (code: number | null) => void } {
  const writes: string[] = [];
  let exitResolve: (value: { code: number | null }) => void = () => {};
  const stdoutCbs = new Set<(chunk: string) => void>();
  const exitCbs = new Set<(code: number | null) => void>();
  const exited = new Promise<{ code: number | null }>((resolve) => {
    exitResolve = resolve;
  });
  let closed = false;
  const finish = (code: number | null): void => {
    if (closed) return;
    closed = true;
    exitResolve({ code });
    for (const cb of exitCbs) cb(code);
  };
  return {
    pid: 4242,
    writes,
    pushLines: (lines) => {
      for (const cb of stdoutCbs) cb(lines);
    },
    exitWith: finish,
    onStdout: (cb) => stdoutCbs.add(cb),
    onStderr: () => undefined,
    onExit: (cb) => exitCbs.add(cb),
    write: (data) => {
      writes.push(data);
    },
    kill: async () => finish(0),
    exited: () => exited,
  };
}

/** One turn's end, fixture-shaped: session_id d154ee1b-… like trivial-text.jsonl. */
const RESULT_LINE = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "ok",
  session_id: "d154ee1b-a065-42dc-b523-c5810f077d2d",
  duration_ms: 1,
  num_turns: 1,
  total_cost_usd: 0,
  usage: { input_tokens: 1, output_tokens: 1 },
}) + "\n";

/** The user message the adapter must put on the stdin channel (ADR-0098). */
function stdinPrompt(line: string): { type: string; message: { role: string; content: string }; parent_tool_use_id: null } {
  return JSON.parse(line);
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
    expect(adapter.capabilities().features).toMatchObject({ followUp: true, interrupt: true, toolGate: "native", questions: true, skills: true, agents: true, modelChoice: "start" });
    // EPIC-P35 T35.3: „Weitermachen“ nach Unterbrechung — der Idle-Pfad
    // (start ohne Prompt, ADR-0040) ist die hub-fähige promptlose Übernahme.
    expect(adapter.capabilities().resume).toMatchObject({ ref: "native", hub: true });
    expect(createAdapter({ permissionPrompts: "off" }).capabilities().features).toMatchObject({ toolGate: "allowlist", questions: false });
    // ADR-0018: the flag the live hub runs with means every tool runs unasked.
    expect(createAdapter({ extraArgs: ["--dangerously-skip-permissions"] }).capabilities().features.toolGate).toBe("bypass");
    expect(createAdapter({ extraArgs: ["--permission-mode", "bypassPermissions"] }).capabilities().features.toolGate).toBe("bypass");
    // ADR-0014: recover() adopts a surviving turn or resumes natively.
    expect(typeof adapter.recover).toBe("function");
  });

  it("EPIC-P35 T35.7/ADR-0054: modelsCommand schlägt die dokumentierten Aliase; ohne Config bleiben sie", async () => {
    expect(await createAdapter().models!()).toEqual([
      { id: "fable", label: "Fable" },
      { id: "opus", label: "Opus" },
      { id: "sonnet", label: "Sonnet" },
      { id: "haiku", label: "Haiku" },
    ]);
    const configured = createAdapter({ modelsCommand: ["printf", "zai/glm-5.3\tGLM 5.3\nclaude-fable"] });
    expect(await configured.models!()).toEqual([
      { id: "zai/glm-5.3", label: "GLM 5.3" },
      { id: "claude-fable" },
    ]);
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
    const handle = await adapter.start({ adapter: "claude", project: "/tmp", prompt: "x" }, ctx);

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
    const handle = await adapter.start({ adapter: "claude", project: "/tmp", prompt: "x" }, ctx);

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
    const handle = await adapter.start({ adapter: "claude", project: "/tmp", prompt: "x" }, ctx);
    await adapter.stop(handle, ctx);
    expect(killed).toBe(true);
    expect((await adapter.status(handle)).state).toBe("down");
  });

  it("steer(prompt) nach Exit resumed mit der session_id aus der init-Zeile des Streams", async () => {
    const spawnedCmds: string[][] = [];
    const proc = fakeStreamingClaude();
    const ctx = makeRecordingContext({
      spawnWorker: async (cmd) => {
        spawnedCmds.push(cmd);
        return proc;
      },
    });
    const adapter = createAdapter();
    const handle = await adapter.start({ adapter: "claude", project: "/tmp", prompt: "first" }, ctx);
    // die session_id aus der system/init-Zeile der Fixture übernehmen
    proc.pushLines(`${JSON.stringify({ type: "system", subtype: "init", cwd: "/tmp", session_id: "d154ee1b-a065-42dc-b523-c5810f077d2d", tools: [] })}\n`);
    proc.exitWith(0);
    await proc.exited();

    const ack = await adapter.steer(handle, { kind: "prompt", text: "follow up" }, ctx);
    expect(ack.ok).toBe(true);
    expect(spawnedCmds).toHaveLength(2);
    expect(spawnedCmds[1]).toContain("--resume");
    expect(spawnedCmds[1]).toContain("d154ee1b-a065-42dc-b523-c5810f077d2d");
  });

  it("T1.5-10: args.skill prefixes every prompt with /skill — initial send and steering alike", async () => {
    const proc = fakeStreamingClaude();
    const ctx = makeRecordingContext({
      spawnWorker: async () => proc,
    });
    const adapter = createAdapter();
    const handle = await adapter.start(
      { adapter: "claude", project: "/tmp", prompt: "fix it", args: { skill: "bugfix" } },
      ctx,
    );
    expect(stdinPrompt(proc.writes[0]!).message.content).toBe("/bugfix\n\nfix it");

    await adapter.steer(handle, { kind: "prompt", text: "follow up" }, ctx);
    // Reapplied on the steered turn too — a skill choice is fixed for the
    // whole session, not re-selectable per turn (ADR-0005).
    expect(stdinPrompt(proc.writes[1]!).message.content).toBe("/bugfix\n\nfollow up");
  });

  it("T1.5-10: args.agent appends --agent on the initial spawn only, never on a resume", async () => {
    const spawnedCmds: string[][] = [];
    const proc = fakeStreamingClaude();
    const ctx = makeRecordingContext({
      spawnWorker: async (cmd) => {
        spawnedCmds.push(cmd);
        return proc;
      },
    });
    const adapter = createAdapter();
    const handle = await adapter.start(
      { adapter: "claude", project: "/tmp", prompt: "go", args: { agent: "hub-dev" } },
      ctx,
    );
    expect(spawnedCmds[0]).toContain("--agent");
    expect(spawnedCmds[0]).toContain("hub-dev");
    proc.exitWith(0);
    await proc.exited();

    await adapter.steer(handle, { kind: "prompt", text: "follow up" }, ctx);
    // ADR-0005: whether --agent still does anything on --resume is
    // unverified, so it's deliberately never re-added.
    expect(spawnedCmds[1]).not.toContain("--agent");
  });

  it("T1.6-6 / ADR-0033: the session's model rides on the first spawn and on every resumed turn", async () => {
    const spawnedCmds: string[][] = [];
    const proc = fakeStreamingClaude();
    const ctx = makeRecordingContext({
      spawnWorker: async (cmd) => {
        spawnedCmds.push(cmd);
        return proc;
      },
    });
    const adapter = createAdapter();
    const handle = await adapter.start({ adapter: "claude", project: "/tmp", prompt: "go", model: "opus" }, ctx);
    expect(spawnedCmds[0]).toContain("--model");
    expect(spawnedCmds[0]).toContain("opus");
    proc.exitWith(0);
    await proc.exited();

    await adapter.steer(handle, { kind: "prompt", text: "follow up" }, ctx);
    // Verified live against claude 2.1.288: --model is honoured on --resume.
    // Dropping it let a resumed turn fall back to the CLI default.
    expect(spawnedCmds[1]).toContain("--model");
    expect(spawnedCmds[1]).toContain("opus");
  });

  describe("ADR-0033 permission mode and model switching", () => {
    const modeOf = (cmd: string[] | undefined) => cmd?.[cmd.indexOf("--permission-mode") + 1];
    const harness = () => {
      const spawned: string[][] = [];
      const proc = fakeStreamingClaude();
      const ctx = makeRecordingContext({
        spawnWorker: async (cmd) => {
          spawned.push(cmd);
          return proc;
        },
      });
      return { spawned, ctx, proc };
    };

    it("declares its modes and model switching in the features", () => {
      const features = createAdapter().capabilities().features;
      expect(features.permissionModes).toEqual(["auto", "manual", "plan", "acceptEdits", "dontAsk", "bypassPermissions"]);
      expect(features.modelSwitch).toBe(true);
    });

    it("starts in the requested mode and keeps it on every later turn", async () => {
      const { spawned, ctx, proc } = harness();
      const adapter = createAdapter();
      const handle = await adapter.start({ adapter: "claude", project: "/tmp", prompt: "go", args: { permissionMode: "plan" } }, ctx);
      proc.exitWith(0);
      await proc.exited();
      await adapter.steer(handle, { kind: "prompt", text: "weiter" }, ctx);
      expect(modeOf(spawned[0])).toBe("plan");
      expect(modeOf(spawned[1])).toBe("plan");
    });

    it("configure changes mode and model from the next turn on", async () => {
      const { spawned, ctx, proc } = harness();
      const adapter = createAdapter();
      const handle = await adapter.start({ adapter: "claude", project: "/tmp", prompt: "go", model: "haiku", args: { permissionMode: "manual" } }, ctx);
      proc.exitWith(0);
      await proc.exited();
      expect((await adapter.steer(handle, { kind: "configure", permissionMode: "auto", model: "sonnet" }, ctx)).ok).toBe(true);
      await adapter.steer(handle, { kind: "prompt", text: "weiter" }, ctx);
      expect(modeOf(spawned[1])).toBe("auto");
      expect(spawned[1]![spawned[1]!.indexOf("--model") + 1]).toBe("sonnet");
    });


    it("waits for the running CLI to acknowledge a model change", async () => {
      const { ctx, proc, spawned } = harness();
      const adapter = createAdapter();
      const handle = await adapter.start({ adapter: "claude", project: "/tmp", prompt: "go", model: "haiku" }, ctx);
      const configure = adapter.steer(handle, { kind: "configure", model: "sonnet" }, ctx);
      const request = JSON.parse(proc.writes[1] ?? "null");
      expect(request).toMatchObject({ type: "control_request", request: { subtype: "set_model", model: "sonnet" } });
      proc.pushLines(JSON.stringify({ type: "control_response", response: {
        subtype: "success", request_id: request.request_id, response: { model: "claude-sonnet-5" },
      } }) + "\n");
      expect(await configure).toEqual({ ok: true });
      expect(spawned).toHaveLength(1);
    });

    it("refuses an unknown mode instead of ignoring it", async () => {
      const { ctx } = harness();
      const adapter = createAdapter();
      const handle = await adapter.start({ adapter: "claude", project: "/tmp", prompt: "go" }, ctx);
      const ack = await adapter.steer(handle, { kind: "configure", permissionMode: "yolo" }, ctx);
      expect(ack.ok).toBe(false);
      expect(ack.detail).toContain("yolo");
    });

    it("the session's mode replaces a --permission-mode an operator put in extraArgs", async () => {
      const { spawned, ctx } = harness();
      const adapter = createAdapter({ extraArgs: ["--permission-mode", "manual", "--verbose-extra"] });
      await adapter.start({ adapter: "claude", project: "/tmp", prompt: "go", args: { permissionMode: "auto" } }, ctx);
      const cmd = spawned[0]!;
      expect(cmd.filter((a) => a === "--permission-mode")).toHaveLength(1);
      expect(modeOf(cmd)).toBe("auto");
      expect(cmd).toContain("--verbose-extra");
    });

    it("without any mode it adds no flag (adapter-wide fallback optional)", async () => {
      const { spawned, ctx } = harness();
      await createAdapter().start({ adapter: "claude", project: "/tmp", prompt: "go" }, ctx);
      expect(spawned[0]).not.toContain("--permission-mode");
      const { spawned: s2, ctx: c2 } = harness();
      await createAdapter({ permissionMode: "acceptEdits" }).start({ adapter: "claude", project: "/tmp", prompt: "go" }, c2);
      expect(modeOf(s2[0])).toBe("acceptEdits");
    });
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
    await adapter.start({ adapter: "claude", project: "/tmp", prompt: "x" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.summary.includes("non-JSON stdout line")));
  });

  it("e2e-Fund 2026-11-20: promptloser Start spawnt NICHTS — die Session bleibt idle, der erste steer spawnt", async () => {
    const spawned: string[][] = [];
    const ctx = makeRecordingContext({
      spawnWorker: async (cmd) => {
        spawned.push(cmd);
        return fakeStreamingClaude();
      },
    });
    const adapter = createAdapter();
    const handle = await adapter.start({ adapter: "claude", project: "/tmp" }, ctx);
    expect(spawned).toHaveLength(0);
    expect((await adapter.status(handle)).state).toBe("healthy");
    await adapter.steer(handle, { kind: "prompt", text: "los" }, ctx);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).not.toContain("--resume");
  });

  it("BUG-0040: Klartext-Fehler 'Error: No deferred tool marker…' wird als lesbarer Resume-Hinweis gemeldet", async () => {
    const content = "Error: No deferred tool marker found in the resumed session\n";
    const ctx = makeRecordingContext({ spawnWorker: async () => fakeClaudeProcess(content) });
    const adapter = createAdapter();
    await adapter.start({ adapter: "claude", project: "/tmp", prompt: "x" }, ctx);
    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "claude.cli_error"));
    const ev = ctx.events.find((e) => (e.payload as { kind?: string }).kind === "claude.cli_error")!;
    expect((ev.payload as { resumeStale?: boolean }).resumeStale).toBe(true);
    expect(ev.summary).toContain("Resume fehlgeschlagen");
    expect(ctx.events.some((e) => e.summary.includes("non-JSON stdout line"))).toBe(false);
  });

  it("BUG-0040: anderer 'Error:'-Klartext wird mit Text gemeldet, resumeStale ist false", async () => {
    const ctx = makeRecordingContext({ spawnWorker: async () => fakeClaudeProcess("Error: boom\n") });
    const adapter = createAdapter();
    await adapter.start({ adapter: "claude", project: "/tmp", prompt: "x" }, ctx);
    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "claude.cli_error"));
    const ev = ctx.events.find((e) => (e.payload as { kind?: string }).kind === "claude.cli_error")!;
    expect(ev.summary).toBe("claude: CLI-Fehler — Error: boom");
    expect((ev.payload as { resumeStale?: boolean }).resumeStale).toBe(false);
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

  it("ADR-0018 §3: asks the hub through the permission bridge, with a long MCP tool timeout", async () => {
    const calls: { cmd: string[]; env?: Record<string, string> }[] = [];
    const procs = [fakeStreamingClaude(), fakeStreamingClaude()];
    const ctx = makeRecordingContext({
      spawnWorker: async (cmd, opts) => {
        calls.push({ cmd, ...(opts?.env ? { env: opts.env } : {}) });
        return procs[calls.length - 1]!;
      },
      permissionBridge: async () => ({ mcpConfigPath: "/data/bridges/s.mcp.json", toolName: "mcp__ancientvoid__permission" }),
    });
    const adapter = createAdapter();
    const handle = await adapter.start({ adapter: "claude", project: "/tmp", prompt: "hallo" }, ctx);
    // ADR-0098: der Respawn nach Exit trägt die Brücke genauso wie der erste Prozess.
    procs[0]!.exitWith(0);
    await procs[0]!.exited();
    await adapter.steer(handle, { kind: "prompt", text: "weiter" }, ctx);
    for (const call of calls) {
      expect(call.cmd.join(" ")).toContain("--mcp-config /data/bridges/s.mcp.json --permission-prompt-tool mcp__ancientvoid__permission");
      expect(call.env?.MCP_TOOL_TIMEOUT).toBe("3600000");
    }
    expect(calls).toHaveLength(2);

    const bypass = createAdapter({ extraArgs: ["--dangerously-skip-permissions"] });
    calls.length = 0;
    await bypass.start({ adapter: "claude", project: "/tmp", prompt: "hallo" }, ctx);
    expect(calls[0]!.cmd).not.toContain("--permission-prompt-tool");
  });

  it("says so in the tail when the hub offers no bridge", async () => {
    const ctx = makeRecordingContext({ spawnWorker: async () => fakeClaudeProcess(loadFixture("trivial-text.jsonl")) });
    await createAdapter().start({ adapter: "claude", project: "/tmp", prompt: "hallo" }, ctx);
    expect(ctx.events.some((e) => (e.payload as { kind?: string }).kind === "claude.no_permission_bridge")).toBe(true);
  });

  it("T7.10: images and PDFs by path with --add-dir, other files as text", async () => {
    const calls: string[][] = [];
    const proc = fakeStreamingClaude();
    const ctx = makeRecordingContext({ spawnWorker: async (cmd) => { calls.push(cmd); return proc; } });
    await createAdapter({ permissionPrompts: "off" }).start({
      adapter: "claude",
      project: "/tmp",
      prompt: "Bitte ansehen",
      attachments: [
        { id: "a".repeat(64), name: "scan.pdf", mimeType: "application/pdf", kind: "pdf", bytes: 2048, path: "/data/att/aaa", text: "egal", method: "pdftotext" },
        { id: "b".repeat(64), name: "tabelle.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "office", bytes: 4096, path: "/data/att/bbb", text: "Artikel;Preis", method: "office" },
      ],
    }, ctx);
    const cmd = calls[0]!;
    const prompt = stdinPrompt(proc.writes[0]!).message.content;
    expect(prompt).toContain("scan.pdf");
    expect(prompt).toContain("Datei: /data/att/aaa]\n(als Datei übergeben)");
    expect(prompt).toContain("Artikel;Preis");
    expect(cmd.join(" ")).toContain("--add-dir /data/att");
  });
});

describe("Streaming-Input-Prozess (ADR-0098 / BUG-0235)", () => {
  it("capabilities verspricht midTurnInput — Zustellung wählbar wie bei Pi", () => {
    expect(createAdapter().capabilities()).toMatchObject({ promptDelivery: "next-turn", midTurnInput: true, promptlessStartIdle: true });
  });

  it("start() spawnt einen persistenten stdin-Pipe-Prozess; der Prompt geht als NDJSON-Zeile, nie ins Argv", async () => {
    const spawned: { cmd: string[]; opts?: { stdin?: string; persistent?: boolean } }[] = [];
    const turns: string[] = [];
    const proc = fakeStreamingClaude();
    const ctx = makeRecordingContext({
      spawnWorker: async (cmd, opts) => {
        spawned.push({ cmd, ...(opts !== undefined ? { opts } : {}) });
        return proc;
      },
      turn: (state) => turns.push(state),
    });
    await createAdapter().start({ adapter: "claude", project: "/tmp", prompt: "erster Auftrag" }, ctx);

    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.cmd).toContain("--input-format");
    expect(spawned[0]!.cmd[spawned[0]!.cmd.indexOf("--input-format") + 1]).toBe("stream-json");
    expect(spawned[0]!.cmd).not.toContain("erster Auftrag");
    expect(spawned[0]!.opts).toMatchObject({ stdin: "pipe", persistent: true });
    expect(proc.writes).toHaveLength(1);
    expect(stdinPrompt(proc.writes[0]!)).toEqual({
      type: "user",
      message: { role: "user", content: "erster Auftrag" },
      parent_tool_use_id: null,
    });
    expect(proc.writes[0]).toMatch(/\n$/);
    expect(turns).toEqual(["working"]);
  });

  it("BUG-0235/ADR-0074: steer(prompt) schreibt in den LAUFENDEN Prozess — kein Zweitprozess, auch mitten im Zug", async () => {
    const spawned: string[][] = [];
    const proc = fakeStreamingClaude();
    const ctx = makeRecordingContext({
      spawnWorker: async (cmd) => {
        spawned.push(cmd);
        return proc;
      },
    });
    const adapter = createAdapter();
    const handle = await adapter.start({ adapter: "claude", project: "/tmp", prompt: "erster Auftrag" }, ctx);

    // Kein result bisher — der Zug „läuft“. Der Zwischenruf geht trotzdem raus.
    const ack = await adapter.steer(handle, { kind: "prompt", text: "zwischenruf: mach weiter so" }, ctx);
    expect(ack.ok).toBe(true);
    expect(spawned).toHaveLength(1);
    expect(proc.writes).toHaveLength(2);
    expect(stdinPrompt(proc.writes[1]!).message.content).toBe("zwischenruf: mach weiter so");
  });

  it("result im Stream meldet ctx.turn(idle) — die Queue des Hubs kann sofort weiterlaufen", async () => {
    const turns: string[] = [];
    const proc = fakeStreamingClaude();
    const ctx = makeRecordingContext({
      spawnWorker: async () => proc,
      turn: (state) => turns.push(state),
    });
    const adapter = createAdapter();
    const handle = await adapter.start({ adapter: "claude", project: "/tmp", prompt: "eins" }, ctx);
    proc.pushLines(RESULT_LINE);
    await waitFor(() => turns.includes("idle"));
    expect(turns).toEqual(["working", "idle"]);

    // Nächster Zug: derselbe Prozess, kein Respawn.
    await adapter.steer(handle, { kind: "prompt", text: "zwei" }, ctx);
    expect(proc.writes).toHaveLength(2);
    expect(turns).toEqual(["working", "idle", "working"]);
  });

  it("nach sauberem Exit startet der nächste Prompt einen --resume-Prozess (Prompt weiterhin auf stdin)", async () => {
    const spawned: string[][] = [];
    const procs = [fakeStreamingClaude(), fakeStreamingClaude()];
    const ctx = makeRecordingContext({
      spawnWorker: async (cmd) => {
        spawned.push(cmd);
        return procs[spawned.length - 1]!;
      },
    });
    const adapter = createAdapter();
    const handle = await adapter.start({ adapter: "claude", project: "/tmp", prompt: "first" }, ctx);
    procs[0]!.pushLines(RESULT_LINE); // session_id d154ee1b-… wird übernommen
    procs[0]!.exitWith(0);
    await procs[0]!.exited();

    await adapter.steer(handle, { kind: "prompt", text: "follow up" }, ctx);
    expect(spawned).toHaveLength(2);
    expect(spawned[1]).toContain("--resume");
    expect(spawned[1]).toContain("d154ee1b-a065-42dc-b523-c5810f077d2d");
    expect(spawned[1]).not.toContain("follow up");
    expect(procs[1]!.writes).toHaveLength(1);
    expect(stdinPrompt(procs[1]!.writes[0]!).message.content).toBe("follow up");
  });

  it("Attachments im laufenden Zug: --add-dir ist nicht nachrüstbar → sichtbares Event, Prompt geht trotzdem", async () => {
    const proc = fakeStreamingClaude();
    const ctx = makeRecordingContext({ spawnWorker: async () => proc });
    const adapter = createAdapter();
    const handle = await adapter.start({ adapter: "claude", project: "/tmp", prompt: "los" }, ctx);
    await adapter.steer(handle, {
      kind: "prompt",
      text: "schau dir den Scan an",
      attachments: [{ id: "a".repeat(64), name: "scan.pdf", mimeType: "application/pdf", kind: "pdf", bytes: 2048, path: "/data/att/aaa", text: "egal", method: "pdftotext" }],
    }, ctx);
    expect(ctx.events.some((e) => (e.payload as { kind?: string }).kind === "claude.add_dir_live_skipped")).toBe(true);
    expect(stdinPrompt(proc.writes[1]!).message.content).toContain("/data/att/aaa");
  });
});

describe("Fortsetzen: Wächter und Transkript-Import (Live-Fund 2026-09-28)", () => {
  it("eine nicht-UUID-Resume-Id (Subagent-Transkript) scheitert laut, VOR dem Spawn", async () => {
    let spawned = 0;
    const ctx = makeRecordingContext({ spawnWorker: async () => { spawned += 1; return fakeClaudeProcess(""); } });
    await expect(
      createAdapter().start({ adapter: "claude", project: "/tmp", prompt: "x", args: { resumeSessionId: "agent-a648a44cee0100a8c" } }, ctx),
    ).rejects.toThrow("keine Session-ID");
    expect(spawned).toBe(0);
  });

  it("beim Fortsetzen steht die Transkript-Historie im Tail, bevor der neue Zug läuft", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const sid = "485d0730-cd5d-43a9-8fdb-232219f80f1d";
    const dir = mkdtempSync(join(tmpdir(), "claude-hist-"));
    const munged = process.cwd().replace(/[^a-zA-Z0-9]/g, "-");
    mkdirSync(join(dir, "projects", munged), { recursive: true });
    writeFileSync(join(dir, "projects", munged, `${sid}.jsonl`), loadFixture("tool-use.jsonl"));
    const ctx = makeRecordingContext({ spawnWorker: async () => fakeClaudeProcess(loadFixture("trivial-text.jsonl")) });
    const adapter = createAdapter({ claudeDir: dir });

    await adapter.start({ adapter: "claude", project: "/tmp", prompt: "weiter", args: { resumeSessionId: sid } }, ctx);

    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "claude.transcript_imported"));
    const marker = ctx.events.findIndex((e) => (e.payload as { kind?: string }).kind === "claude.transcript_imported");
    expect(marker).toBeGreaterThanOrEqual(0);
    // imported history: the fixture's tool_use + assistant events arrive after the marker
    expect(ctx.events.slice(marker).some((e) => e.type === "tool_use")).toBe(true);
    expect(ctx.events.slice(marker).some((e) => e.type === "assistant")).toBe(true);
    // and the new turn runs on top
    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "claude.result"));
    const result = ctx.events.findIndex((e) => (e.payload as { kind?: string }).kind === "claude.result");
    expect(result).toBeGreaterThan(marker);
  });

  it("ADR-0040: eine Übernahme ohne Prompt startet keinen Prozess — der nächste Zug setzt fort", async () => {
    const sid = "485d0730-cd5d-43a9-8fdb-232219f80f1d";
    const calls: string[][] = [];
    const ctx = makeRecordingContext({ spawnWorker: async (cmd) => { calls.push(cmd); return fakeClaudeProcess(loadFixture("trivial-text.jsonl")); } });
    const adapter = createAdapter({ claudeDir: "/nirgendwo" });
    const handle = await adapter.start({ adapter: "claude", project: "/tmp", args: { resumeSessionId: sid } }, ctx);
    expect(calls).toHaveLength(0);
    await adapter.steer(handle, { kind: "prompt", text: "weiter" }, ctx);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("--resume");
    expect(calls[0]).toContain(sid);
    expect(calls[0]).not.toContain("--fork-session");
  });

  it("ADR-0040: forkSession setzt nur den ersten Zug als Kopie fort, danach läuft die Kopie selbst", async () => {
    const sid = "485d0730-cd5d-43a9-8fdb-232219f80f1d";
    const calls: string[][] = [];
    const ctx = makeRecordingContext({ spawnWorker: async (cmd) => { calls.push(cmd); return fakeClaudeProcess(loadFixture("trivial-text.jsonl")); } });
    const adapter = createAdapter({ claudeDir: "/nirgendwo" });
    const handle = await adapter.start({ adapter: "claude", project: "/tmp", args: { resumeSessionId: sid, forkSession: true } }, ctx);
    await adapter.steer(handle, { kind: "prompt", text: "eins" }, ctx);
    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "claude.result"));
    await adapter.steer(handle, { kind: "prompt", text: "zwei" }, ctx);
    expect(calls[0]).toContain("--fork-session");
    expect(calls[1]).not.toContain("--fork-session");
  });

  it("ADR-0040: forkSession mit Prompt forkt schon beim Start", async () => {
    const sid = "485d0730-cd5d-43a9-8fdb-232219f80f1d";
    const calls: string[][] = [];
    const ctx = makeRecordingContext({ spawnWorker: async (cmd) => { calls.push(cmd); return fakeClaudeProcess(loadFixture("trivial-text.jsonl")); } });
    await createAdapter({ claudeDir: "/nirgendwo" }).start({ adapter: "claude", project: "/tmp", prompt: "los", args: { resumeSessionId: sid, forkSession: true } }, ctx);
    expect(calls[0]).toContain("--fork-session");
  });

  it("ohne Transkript gibt es eine sichtbare Notiz statt Stillstand", async () => {
    const sid = "00000000-0000-4000-8000-000000000000";
    const ctx = makeRecordingContext({ spawnWorker: async () => fakeClaudeProcess(loadFixture("trivial-text.jsonl")) });
    await createAdapter({ claudeDir: "/nirgendwo" }).start({ adapter: "claude", project: "/tmp", prompt: "weiter", args: { resumeSessionId: sid } }, ctx);
    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "claude.transcript_missing"));
  });
});

/**
 * ADR-0083 / BUG-0178: claude carries its deltas inside `stream_event` envelopes.
 * The lines below are synthetic (same shape the stand-in in e2e/support/bin/claude
 * speaks) — recorded claude transcripts never carry partial deltas.
 */
const PARTIAL_STREAM = [
  { type: "system", subtype: "init", session_id: "s9", cwd: "/tmp", tools: ["Bash"], model: "claude-sonnet-5", permissionMode: "default", claude_code_version: "2.1.280" },
  { type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text" } }, session_id: "s9" },
  { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Live " } }, session_id: "s9" },
  { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "streamt " } }, session_id: "s9" },
  { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Wort für Wort." } }, session_id: "s9" },
  { type: "stream_event", event: { type: "content_block_stop", index: 0 }, session_id: "s9" },
  { type: "assistant", message: { id: "m9", role: "assistant", content: [{ type: "text", text: "Live streamt Wort für Wort." }] }, session_id: "s9" },
  { type: "result", subtype: "success", is_error: false, result: "Live streamt Wort für Wort.", session_id: "s9", num_turns: 1, duration_ms: 5, total_cost_usd: 0, usage: { input_tokens: 3, output_tokens: 6 } },
].map((l) => JSON.stringify(l)).join("\n") + "\n";

describe("claude adapter — echte Deltas als Live-Frames (ADR-0083)", () => {
  it("frames gehen raus, bevor der Block eintrifft, und der Block kommt genau einmal", async () => {
    let spawned: string[] = [];
    const ctx = makeRecordingContext({
      spawnWorker: async (cmd) => {
        spawned = cmd;
        return fakeClaudeProcess(PARTIAL_STREAM, 60);
      },
    });
    await createAdapter().start({ adapter: "claude", project: "/tmp", prompt: "STREAM" }, ctx);
    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "claude.result"));

    // ADR-0083: der Hub kann Frames — der Adapter verlangt dafuer Teil-Nachrichten.
    expect(spawned).toContain("--include-partial-messages");

    const text = ctx.frames.map((f) => f.text).join("");
    expect(text).toBe("Live streamt Wort für Wort.");
    expect(ctx.frames.every((f) => f.stream === "assistant" && f.turnId.length > 0)).toBe(true);
    expect(ctx.frames.map((f) => f.seq)).toEqual(ctx.frames.map((_, i) => i));
    expect(ctx.frames.at(-1)!.final).toBe(true);
    expect(ctx.frames.slice(0, -1).every((f) => !f.final)).toBe(true);

    // Kein Doppellauf: der Block bleibt das eine dauerhafte assistant-Ereignis,
    // und die erkannten Deltas hinterlassen keine "stream envelope"-Rausch-Ereignisse.
    expect(ctx.events.filter((e) => e.type === "assistant")).toHaveLength(1);
    expect(ctx.events.some((e) => e.summary.includes("stream envelope"))).toBe(false);
  });

  it("ohne Stream-Kanal bleibt alles beim Alten: kein Frame, Block bleibt erhalten", async () => {
    const ctx = makeRecordingContext({ spawnWorker: async () => fakeClaudeProcess(PARTIAL_STREAM, 60) });
    delete ctx.stream; // ADR-0083: ein Hub ohne Frame-Kanal
    await createAdapter().start({ adapter: "claude", project: "/tmp", prompt: "STREAM" }, ctx);
    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "claude.result"));
    expect(ctx.frames).toHaveLength(0);
    expect(ctx.events.filter((e) => e.type === "assistant")).toHaveLength(1);
    const joined = ctx.events.filter((e) => e.type === "assistant").map((e) => JSON.stringify(e.payload)).join("");
    expect(joined).toContain("Live streamt Wort für Wort.");
  });
});
