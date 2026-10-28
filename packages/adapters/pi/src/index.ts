import { z } from "zod";
import {
  providerErrorEvent,
  type Adapter,
  type AdapterCapabilities,
  type AdapterContext,
  type Ack,
  type HealthReport,
  type SessionHandle,
  type SessionSpec,
  type SteerInput,
  type WorkerProcess,
} from "@uacc/contracts";
import { homedir } from "node:os";
import { join } from "node:path";
import { createPiStream } from "./normalize.ts";
import { findSessionFile, isSessionId, readTranscript } from "./transcript.ts";

/**
 * pi adapter (pi coding agent, badlogic/pi). Spawns `pi -p --mode json --continue`
 * per turn — pi keeps its own session state in ~/.pi/agent/sessions keyed
 * by cwd, so consecutive turns in the same project continue the thread.
 *
 * Verified behaviour (evox2 + zeratul, 2026-10-25):
 * - headless ONLY without a pty; the hub's tmux worker provides one, but
 *   pi -p exits fine when stdin is not a terminal — it never blocks.
 * - model choice via `--model provider/id`; custom providers from
 *   ~/.pi/agent/models.json (providers-OBJECT, apiKey directly).
 *
 * Config (hub.config.json -> adapters[].config):
 *   command:   executable (default "pi").
 *   extraArgs: extra CLI args appended verbatim.
 */
const PiConfig = z.object({
  command: z.string().min(1).default("pi"),
  extraArgs: z.array(z.string()).default([]),
  /** Registered default `--model provider/id` (e.g. the evox2 qwen). A
   * session's own model choice (SessionSpec.model) always wins — without
   * either, pi runs its own default and the hub says so honestly. */
  model: z.string().min(1).optional(),
  /** ADR-0032: the model's context window in tokens, from pi's own
   * models.json (`contextWindow`) — pi does not report it in the stream. */
  contextWindowTokens: z.number().int().positive().optional(),
  /** ADR-0041: where pi keeps its session files (adoption looks sessions up here). Default: pi's own. */
  sessionsDir: z.string().min(1).optional(),
});

/** ADR-0041: start arguments of an adoption (set by the hub, never by the person). */
const PiSessionArgs = z
  .object({
    resumeSessionId: z.string().min(1).optional(),
    /** Continue as a copy (`--fork`): the original stays untouched. First turn only. */
    forkSession: z.boolean().optional(),
    importHistory: z.boolean().optional(),
  })
  .optional();

/** Keep the imported window short: the phone needs "where do I stand", not three weeks of tool output. */
const IMPORT_LIMIT = 200;
type PiConfig = z.infer<typeof PiConfig>;

interface SessionMeta {
  healthy: boolean;
  busy: boolean;
}

export function createAdapter(config?: Readonly<Record<string, unknown>>): Adapter {
  const cfg: PiConfig = PiConfig.parse(config ?? {});
  const procs = new Map<string, WorkerProcess>();
  const sessions = new Map<string, SessionMeta>();
  const sessionModels = new Map<string, string | undefined>();
  const sessionsDir = cfg.sessionsDir ?? join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "sessions");
  /** ADR-0041: an adopted session is addressed by its file (`pi --session <path>` also finds other projects'
   * sessions, an id does not); a fork uses `--fork` for its first turn only. */
  const resumes = new Map<string, { file: string; fork: boolean }>();

  function buildArgs(prompt: string, model: string | undefined, first: boolean, resume?: { file: string; fork: boolean }): string[] {
    // pi -p hangs when stdin is a TTY (hub workers run under tmux) — route
    // through sh with stdin redirected from /dev/null, stdout stays piped.
    // BUG-0066: pi 1.4.0 has no `exec` subcommand — positionals are messages,
    // so `exec` became its own turn. `-p` is the headless mode; `--` keeps a
    // prompt starting with "-" from being read as a flag.
    const piArgs = [cfg.command, "-p", "--mode", "json"];
    if (resume) piArgs.push(resume.fork ? "--fork" : "--session", resume.file);
    else if (!first) piArgs.push("--continue");
    if (model) piArgs.push("--model", model);
    piArgs.push(...cfg.extraArgs, "--", prompt);
    const cmdline = piArgs.map((a) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(a) ? a : "'" + a.replace(/'/g, "'\\''") + "'")).join(" ");
    return ["sh", "-c", cmdline + " </dev/null"];
  }

  function attach(ctx: AdapterContext, proc: WorkerProcess, meta: SessionMeta) {
    // Reset per new process: a stale `healthy=false` from a *previous*
    // one-shot turn's abnormal exit must not stick once a fresh process
    // (this steer()'s continuation) actually ran and exited cleanly —
    // same BUG-0008/BUG-0076 lesson as adapter-claude: pi is one-shot per
    // turn, the session between turns is idle, not down.
    meta.healthy = true;
    // BUG-0065: `--mode json` streams thinking, tool calls and results;
    // each finished block is emitted live instead of one text at exit.
    const stream = createPiStream();
    let stderr = "";
    procs.set(ctx.sessionId, proc);
    proc.onStdout((chunk: string) => {
      for (const event of stream.push(chunk)) ctx.emit(event);
    });
    proc.onStderr((chunk: string) => {
      stderr = (stderr + chunk).slice(-2000);
      ctx.log("warn", "pi stderr", { chunk: chunk.slice(0, 500) });
    });
    proc.onExit((code: number | null) => {
      meta.busy = false;
      for (const event of stream.end()) ctx.emit(event);
      // JSON mode keeps stdout for records only — a failing pi says why on
      // stderr, which must not stay in the log alone (fail loud).
      if (code !== 0 && code !== null && stderr.trim()) ctx.emit(providerErrorEvent("pi", stderr.trim()));
      ctx.emit({ type: "system", summary: "pi: turn finished", payload: { kind: "pi.turn_end", code: code ?? 0 } });
      if (code !== 0 && code !== null) meta.healthy = false;
      if (procs.get(ctx.sessionId) === proc) procs.delete(ctx.sessionId);
    });
  }

  /** After the first turn of a fork the copy is the session pi continues in this project (`--continue`). */
  function settleFork(sessionId: string): void {
    if (resumes.get(sessionId)?.fork) resumes.delete(sessionId);
  }

  const adapter: Adapter = {
    id: "pi",
    version: "0.1.0",

    capabilities(): AdapterCapabilities {
      return {
        reasoning: true,
        tools: true,
        cost: false,
        steer: true,
        usage: false,
        nativeDiscovery: "read-only",
        nativeResume: "native",
        ...(cfg.contextWindowTokens !== undefined ? { contextWindowTokens: cfg.contextWindowTokens } : {}),
        features: {
          followUp: true,
          interrupt: true,
          toolGate: "bypass",
          questions: false,
          modelChoice: "start",
          modelSwitch: false,
          permissionModes: [],
          skills: false,
          agents: false,
          images: false,
          files: false,
          contextFork: false,
        },
      };
    },

    async start(spec: SessionSpec, ctx: AdapterContext): Promise<SessionHandle> {
      const args = PiSessionArgs.safeParse(spec.args);
      const resumeId = args.success ? args.data?.resumeSessionId : undefined;
      if (resumeId) {
        if (!isSessionId(resumeId)) throw new Error(`pi kann „${resumeId}" nicht fortsetzen — keine Session-ID (UUID).`);
        const file = findSessionFile(sessionsDir, resumeId);
        if (!file) throw new Error(`pi: Session ${resumeId.slice(0, 8)} nicht gefunden unter ${sessionsDir}`);
        resumes.set(ctx.sessionId, { file, fork: args.success && args.data?.forkSession === true });
        const events = readTranscript(file);
        const shown = events.length > IMPORT_LIMIT ? events.slice(-IMPORT_LIMIT) : events;
        ctx.emit({
          type: "system",
          summary: `pi: Verlauf aus der Session übernommen (${shown.length} von ${events.length} Events, ${resumeId.slice(0, 8)})`,
          payload: { kind: "pi.transcript_imported", session: resumeId, imported: shown.length, total: events.length },
        });
        for (const event of shown) ctx.emit(event);
        if (!spec.prompt?.trim()) {
          // ADR-0041: an adoption without a first prompt has no turn — like recover(), the next prompt resumes.
          sessions.set(ctx.sessionId, { healthy: true, busy: false });
          const model = spec.model ?? cfg.model;
          if (model) sessionModels.set(ctx.sessionId, model);
          return { sessionId: ctx.sessionId };
        }
      }
      const meta: SessionMeta = { healthy: true, busy: true };
      sessions.set(ctx.sessionId, meta);
      // T17-adjacent honesty (2026-10-26): the effective model must be
      // visible, not just configured — record it per session AND emit it
      // as an event, so the UI shows what actually runs even when the
      // default came from this registration's config.
      const model = spec.model ?? cfg.model;
      sessionModels.set(ctx.sessionId, model);
      if (model) {
        ctx.emit({
          type: "system",
          summary: `pi: Modell ${model}`,
          payload: { kind: "pi.model", model, ...(cfg.contextWindowTokens !== undefined ? { contextWindowTokens: cfg.contextWindowTokens } : {}) },
        });
      }
      const proc = await ctx.spawnWorker(
        buildArgs(spec.prompt ?? "(Session startet — bitte bestätigen mit OK)", model, true, resumes.get(ctx.sessionId)),
        spec.env ? { env: spec.env } : undefined,
      );
      settleFork(ctx.sessionId);
      attach(ctx, proc, meta);
      return {
        sessionId: ctx.sessionId,
        ...(proc.pid !== undefined ? { pid: proc.pid } : {}),
      };
    },

    async steer(handle: SessionHandle, input: SteerInput, ctx: AdapterContext): Promise<Ack> {
      switch (input.kind) {
        case "prompt": {
          const meta = sessions.get(handle.sessionId);
          if (meta) meta.busy = true;
          const proc = await ctx.spawnWorker(
            buildArgs(input.text, sessionModels.get(handle.sessionId), false, resumes.get(handle.sessionId)),
            undefined,
          );
          settleFork(handle.sessionId);
          attach(ctx, proc, meta ?? { healthy: true, busy: true });
          return { ok: true };
        }
        case "stop":
          await adapter.stop(handle, ctx);
          return { ok: true };
        case "park": {
          await procs.get(handle.sessionId)?.kill("SIGTERM");
          return { ok: true };
        }
        case "configure":
          return { ok: false, detail: "pi: Modus und Modell lassen sich in dieser Session nicht wechseln" };
        case "resume":
          return { ok: false, detail: "pi: resume needs a prompt — steer with kind: 'prompt' instead" };
      }
    },

    async status(handle: SessionHandle): Promise<HealthReport> {
      const meta = sessions.get(handle.sessionId);
      if (!meta) return { state: "down", detail: "no live process" };
      return { state: meta.healthy ? "healthy" : "down", lastSeen: new Date().toISOString() };
    },

    /** ADR-0041: after a hub restart the session is still addressable by the id it announced. */
    async recover(sessionId: string, _lastSeq: number, ctx: AdapterContext): Promise<SessionHandle | null> {
      const native = ctx.nativeSessionId;
      if (!native) return null;
      const file = findSessionFile(sessionsDir, native);
      if (!file) return null;
      resumes.set(sessionId, { file, fork: false });
      sessions.set(sessionId, { healthy: true, busy: false });
      return { sessionId };
    },

    async stop(handle: SessionHandle): Promise<void> {
      await procs.get(handle.sessionId)?.kill("SIGTERM");
      procs.delete(handle.sessionId);
      sessions.delete(handle.sessionId);
      resumes.delete(handle.sessionId);
    },
  };

  return adapter;
}
