import { z } from "zod";
import type {
  Adapter,
  AdapterCapabilities,
  AdapterContext,
  Ack,
  HealthReport,
  SessionHandle,
  SessionSpec,
  SteerInput,
  WorkerProcess,
} from "@uacc/contracts";

/**
 * Hermes Agent CLI adapter (P13, T13.1).
 *
 * Live-verified CLI contract (2026-10-03, real binary at
 * /home/silenttz/.hermes/hermes-agent/venv/bin/hermes on this host):
 *
 * 1. `hermes chat -q "<prompt>" --yolo -Q --pass-session-id` answers the
 *    query on STDOUT and exits 0.
 * 2. With `--pass-session-id`, a final line `session_id: <sid>` is printed
 *    on STDERR (verified live: stdout was `OK`, stderr carried
 *    `\nsession_id: 20261003_202145_0ee92a`). Parse BOTH streams — never
 *    assume stdout.
 * 3. `--resume <sid>` continues that exact session (verified live: a
 *    follow-up question correctly recalled the first turn's content), and
 *    re-prints `session_id: <sid>` on stderr.
 * 4. `-Q` (quiet) suppresses banner/spinner — only final response + session
 *    info. `--yolo` skips approval prompts (same flag family the cursor
 *    adapter uses).
 * 5. Warnings (e.g. `Warning: Unknown toolsets: a2a`) also land on stderr
 *    BEFORE the answer — stderr is chatty, stdout is the answer.
 *
 * Model/provider are optional via spec.model split on the FIRST ":" —
 * `glm-5.3:zai` → `-m glm-5.3 --provider zai` (analog aider: no spec.model,
 * no model flags; hermes' own config default applies). Provider
 * independence: the adapter never assumes a specific model.
 *
 * Session-ID persistence: captured nativeSessionId lives in per-session
 * meta and handle.meta; every steer(prompt) spawns a FRESH process with
 * `--resume <sid>` (hermes -q is one-shot per invocation — same shape as
 * claude's print mode).
 *
 * Config (hub.config.json -> adapters[].config):
 *   command:   executable to spawn (default "hermes").
 *   extraArgs: extra CLI args appended verbatim.
 */

const HermesConfig = z.object({
  command: z.string().min(1).default("hermes"),
  extraArgs: z.array(z.string()).default([]),
});
type HermesConfig = z.infer<typeof HermesConfig>;

interface SessionMeta {
  healthy: boolean;
  nativeSessionId?: string;
}

/** Matches `session_id: <id>` anywhere in a stderr line (live format has a
 * leading blank line; anchor on the `session_id:` marker, not position). */
const SESSION_ID_RE = /session_id:\s*(\S+)/;

export function extractSessionId(chunk: string): string | null {
  const lines = chunk.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = SESSION_ID_RE.exec(lines[i]!);
    if (m) return m[1]!;
  }
  return null;
}

/** Split a spec.model of the form `model[:provider]` (both parts optional,
 * at least one required). Exported for unit tests. */
export function splitModelSpec(model: string): { model?: string; provider?: string } {
  const idx = model.indexOf(":");
  if (idx === -1) return { model };
  const result: { model?: string; provider?: string } = {};
  const modelPart = model.slice(0, idx).trim();
  const providerPart = model.slice(idx + 1).trim();
  if (modelPart) result.model = modelPart;
  if (providerPart) result.provider = providerPart;
  return result;
}

export function buildHermesArgs(
  prompt: string,
  opts: { nativeSessionId?: string; model?: string; provider?: string; extraArgs?: string[] },
): string[] {
  const args = ["chat", "-q", prompt, "--yolo", "-Q", "--pass-session-id"];
  if (opts.nativeSessionId) args.push("--resume", opts.nativeSessionId);
  if (opts.model) args.push("-m", opts.model);
  if (opts.provider) args.push("--provider", opts.provider);
  args.push(...(opts.extraArgs ?? []));
  return args;
}

export function createAdapter(config?: Readonly<Record<string, unknown>>): Adapter {
  const cfg: HermesConfig = HermesConfig.parse(config ?? {});
  const procs = new Map<string, WorkerProcess>();
  const sessions = new Map<string, SessionMeta>();

  function attach(sessionId: string, proc: WorkerProcess, ctx: AdapterContext, meta: SessionMeta): void {
    meta.healthy = true;
    procs.set(sessionId, proc);
    sessions.set(sessionId, meta);

    // The answer is the whole stdout blob (no structured event stream in -Q
    // mode — verified live, point 2 of the doc comment); one assistant
    // event per turn when the process exits.
    let stdout = "";
    proc.onStdout((chunk) => {
      stdout += chunk;
    });
    // stderr needs LINE buffering, not per-chunk parsing: the tmux runner
    // chunks output arbitrarily, and a `session_id:` line split across two
    // chunks would otherwise be lost silently (breaking every later
    // --resume). Complete lines are parsed, the trailing partial line waits
    // for more data; the exit path flushes it.
    let stderrBuf = "";
    const seenSessionIds = new Set<string>();
    const handleStderrLine = (line: string, ctx: AdapterContext, meta: SessionMeta): void => {
      const sid = extractSessionId(line);
      if (sid && sid !== meta.nativeSessionId && !seenSessionIds.has(sid)) {
        seenSessionIds.add(sid);
        meta.nativeSessionId = sid;
        ctx.emit({
          type: "system",
          summary: `Hermes · Session ${sid}`,
          payload: { kind: "hermes.native_session", nativeSessionId: sid },
        });
      }
    };
    proc.onStderr((chunk) => {
      stderrBuf += chunk;
      const lines = stderrBuf.split("\n");
      stderrBuf = lines.pop() ?? "";
      for (const line of lines) handleStderrLine(line, ctx, meta);
    });
    proc.onExit((code) => {
      // Flush a trailing partial stderr line (process ended without a
      // final newline) — otherwise its session_id would be lost.
      if (stderrBuf) {
        handleStderrLine(stderrBuf, ctx, meta);
        stderrBuf = "";
      }
      // T13.3: hermes prints runtime warnings (e.g. `Warning: Unknown
      // toolsets: a2a`) on STDOUT before the answer — verified live with
      // od -c (2026-10-03). Left in, they would corrupt the assistant
      // text; strip whole lines that are exactly a warning into the hub
      // log instead. Honest heuristic: line-prefix match — a model answer
      // starting a line with "Warning: " would be caught too (accepted,
      // documented trade-off; warnings are one-line and answer-leading).
      const lines = stdout.split("\n");
      const answerLines: string[] = [];
      for (const line of lines) {
        if (/^Warning: /.test(line)) {
          ctx.log("warn", "hermes stdout warning", { line: line.slice(0, 500) });
        } else {
          answerLines.push(line);
        }
      }
      const answer = answerLines.join("\n").trim();
      if (answer) {
        ctx.emit({ type: "assistant", summary: answer.slice(0, 200), payload: { text: answer } });
      }
      // hermes chat -q is one-shot per invocation: a clean exit (0) means
      // the turn finished and the session is idle BETWEEN turns, not down
      // (same lesson as claude BUG-0008 — never mark unhealthy on clean
      // one-shot exit).
      if (code !== 0 && code !== null) {
        meta.healthy = false;
        ctx.emit({ type: "system", summary: `hermes: process exited with code ${code}`, payload: { code } });
      }
      if (procs.get(sessionId) === proc) procs.delete(sessionId);
    });
  }

  async function spawnTurn(
    sessionId: string,
    prompt: string,
    spec: SessionSpec,
    ctx: AdapterContext,
    meta: SessionMeta,
  ): Promise<WorkerProcess> {
    const { model, provider } = spec.model ? splitModelSpec(spec.model) : {};
    const opts: { nativeSessionId?: string; model?: string; provider?: string; extraArgs: string[] } = { extraArgs: cfg.extraArgs };
    if (meta.nativeSessionId) opts.nativeSessionId = meta.nativeSessionId;
    if (model) opts.model = model;
    if (provider) opts.provider = provider;
    const args = buildHermesArgs(prompt, opts);
    const proc = await ctx.spawnWorker(
      [cfg.command, ...args],
      spec.env ? { env: spec.env } : undefined,
    );
    attach(sessionId, proc, ctx, meta);
    return proc;
  }

  const adapter: Adapter = {
    id: "hermes",
    version: "0.1.0",

    capabilities(): AdapterCapabilities {
      // Honest, live-verified 2026-10-03:
      // - reasoning: false — -Q emits only the final response, no
      //   thinking/reasoning stream was observed.
      // - tools: true — hermes runs terminal/file tools itself (--yolo);
      //   tool activity itself is not streamed as events (stdout is the
      //   final answer only), but the harness does perform tool calls.
      // - cost/usage: false — no structured signal for either observed.
      // - nativeResume: "native" — verified live via --resume <sid>.
      return {
        reasoning: false,
        tools: true,
        cost: false,
        steer: true,
        usage: false,
        nativeDiscovery: "none",
        nativeResume: "native",
        features: {
          followUp: true,
          interrupt: true,
          toolGate: "bypass",
          questions: false,
          modelChoice: "start",
          skills: false,
          agents: false,
          images: false,
          files: false,
          contextFork: false,
        },
      };
    },

    async start(spec: SessionSpec, ctx: AdapterContext): Promise<SessionHandle> {
      const meta: SessionMeta = { healthy: true };
      // Adoption (ADR-0011): continue an externally observed hermes session
      // with the first prompt.
      if (spec.adoptNativeSessionId) meta.nativeSessionId = spec.adoptNativeSessionId;
      sessions.set(ctx.sessionId, meta);
      if (spec.prompt) {
        await spawnTurn(ctx.sessionId, spec.prompt, spec, ctx, meta);
      }
      const handle: SessionHandle = {
        sessionId: ctx.sessionId,
        ...(meta.nativeSessionId ? { meta: { nativeSessionId: meta.nativeSessionId } } : {}),
      };
      return handle;
    },

    async steer(handle: SessionHandle, input: SteerInput, ctx: AdapterContext): Promise<Ack> {
      const meta = sessions.get(handle.sessionId);
      if (!meta) return { ok: false, detail: "hermes: unknown session" };
      switch (input.kind) {
        case "prompt": {
          const proc = await spawnTurn(handle.sessionId, input.text, { adapter: "hermes", project: ctx.workdir } as SessionSpec, ctx, meta);
          return { ok: true, ...(proc.pid !== undefined ? { detail: `pid ${proc.pid}` } : {}) };
        }
        case "stop":
          await adapter.stop(handle, ctx);
          return { ok: true };
        case "park": {
          await procs.get(handle.sessionId)?.kill("SIGTERM");
          return { ok: true };
        }
        case "resume":
          return { ok: false, detail: "hermes: resume needs a prompt — steer with kind: 'prompt' instead" };
      }
    },

    async status(handle: SessionHandle): Promise<HealthReport> {
      const meta = sessions.get(handle.sessionId);
      if (!meta) return { state: "down", detail: "no live process" };
      return { state: meta.healthy ? "healthy" : "down", lastSeen: new Date().toISOString() };
    },

    async stop(handle: SessionHandle): Promise<void> {
      await procs.get(handle.sessionId)?.kill("SIGTERM");
      procs.delete(handle.sessionId);
      sessions.delete(handle.sessionId);
    },
  };

  return adapter;
}
