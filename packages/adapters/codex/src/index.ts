import { z } from "zod";
import type {
  Adapter,
  AdapterCapabilities,
  AdapterContext,
  Ack,
  EmittedEvent,
  HealthReport,
  SessionHandle,
  SessionSpec,
  SteerInput,
  WorkerProcess,
} from "@ancientvoid/contracts";
import { normalizeCodexLine, summarize } from "./normalize.ts";
import { createAppServerAdapter } from "./app-server.ts";

/**
 * codex adapter (P1, T1.3). Spawns the real CLI via ctx.spawnWorker (never
 * child_process directly — AdapterContext rule) and maps its `--json`
 * stream-json output through normalize.ts.
 *
 * Config (hub.config.json -> adapters[].config):
 *   command:  executable to spawn (default "codex") — override in tests
 *             to avoid invoking the real CLI.
 *   sandbox:  "read-only" | "workspace-write" | "danger-full-access"
 *             (default "workspace-write") — passed on the INITIAL
 *             invocation only; `codex exec resume` does not accept
 *             --sandbox (verified against the real CLI, codex-cli 0.153.4).
 *   extraArgs: extra CLI args appended verbatim on the initial invocation.
 *   expectedVersion: substring to match against `codex --version`'s
 *             output (e.g. "0.153"). Mismatch is a warning, never an
 *             abort (EPIC-P1 §3: "bei Mismatch Warnung, nicht Abbruch").
 *             Omit to skip the check entirely.
 */

const CodexConfig = z.object({
  command: z.string().min(1).default("codex"),
  sandbox: z.enum(["read-only", "workspace-write", "danger-full-access"]).default("workspace-write"),
  extraArgs: z.array(z.string()).default([]),
  /** Standard-Modell, wenn die Session keins verlangt (spec.model gewinnt). */
  model: z.string().min(1).optional(),
  /** Standard-Reasoning-Aufwand (`model_reasoning_effort`), nur im exec-Modus als -c-Override; app-server liest ihn aus ~/.codex/config.toml. */
  reasoningEffort: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional(),
  expectedVersion: z.string().optional(),
  /** T7.2: "app-server" — one persistent `codex app-server` per session with
   * native approvals, questions, model catalog and quota (ADR-0018 §3).
   * "exec" — one `codex exec` per turn, tools only sandboxed. */
  mode: z.enum(["exec", "app-server"]).default("app-server"),
  /** app-server only: when codex asks before a command or file change. */
  approvalPolicy: z.enum(["untrusted", "on-request", "never"]).default("untrusted"),
});
type CodexConfig = z.infer<typeof CodexConfig>;

/** normalize.ts tags its two fail-loud fallback branches with these payload
 * keys — used here to flip status() to "degraded" per EPIC-P1 §3's
 * Format-Change-Detection requirement, without normalize.ts needing to
 * know about adapter-level session state. */
function isFailLoudFallback(event: EmittedEvent): boolean {
  const payload = event.payload as Record<string, unknown> | undefined;
  return payload !== undefined && ("unhandledType" in payload || "itemType" in payload);
}

interface SessionMeta {
  threadId?: string;
  healthy: boolean;
  degraded: boolean;
  /** T1.11: the model this session requested via SessionSpec.model, if
   * any — carried across resume()s so cost estimation stays consistent
   * for the whole session, not just its first turn. */
  model?: string | undefined;
}

export function createAdapter(config?: Readonly<Record<string, unknown>>): Adapter {
  const cfg: CodexConfig = CodexConfig.parse(config ?? {});
  if (cfg.mode === "app-server") return createAppServerAdapter(cfg);
  const procs = new Map<string, WorkerProcess>();
  const sessions = new Map<string, SessionMeta>();

  function buildInitialArgs(prompt: string, model?: string): string[] {
    return [
      cfg.command,
      "exec",
      prompt,
      "--json",
      "--skip-git-repo-check",
      "--sandbox",
      cfg.sandbox,
      ...(model ? ["--model", model] : []),
      ...(cfg.reasoningEffort ? ["-c", `model_reasoning_effort="${cfg.reasoningEffort}"`] : []),
      ...cfg.extraArgs,
    ];
  }

  function buildResumeArgs(threadId: string, prompt: string, model?: string): string[] {
    // No --sandbox here: `codex exec resume` rejects it (real CLI, verified
    // 2026-09-15) — the resumed turn keeps whatever policy the thread
    // started with. --model IS accepted here (verified via `codex exec
    // resume --help`, same CLI version), unlike --sandbox.
    return [
      cfg.command,
      "exec",
      "--json",
      "resume",
      threadId,
      prompt,
      "--skip-git-repo-check",
      ...(model ? ["--model", model] : []),
    ];
  }

  function attach(sessionId: string, proc: WorkerProcess, ctx: AdapterContext, meta: SessionMeta): void {
    // Reset per new process: a stale `healthy=false` from a *previous*
    // one-shot turn's abnormal exit must not stick forever once a fresh
    // process (this steer()'s resume) is actually running.
    meta.healthy = true;
    procs.set(sessionId, proc);
    sessions.set(sessionId, meta);

    let buffer = "";
    proc.onStdout((chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const rawLine of lines) {
        if (!rawLine.trim()) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(rawLine);
        } catch {
          ctx.emit({
            type: "system",
            summary: "codex: non-JSON stdout line",
            payload: { line: rawLine.slice(0, 500) },
          });
          continue;
        }
        if (parsed && typeof parsed === "object" && "thread_id" in parsed) {
          const tid = (parsed as { thread_id?: unknown }).thread_id;
          if (typeof tid === "string" && tid !== meta.threadId) {
            meta.threadId = tid;
            // ADR-0014: the hub records the id so recover() can resume.
            ctx.emit({ type: "system", summary: `Codex · Thread ${tid}`, payload: { kind: "codex.native_session", nativeSessionId: tid } });
          }
        }
        for (const event of normalizeCodexLine(parsed, meta.model)) {
          ctx.emit(event);
          if (isFailLoudFallback(event)) meta.degraded = true;
        }
      }
    });

    proc.onStderr((chunk) => {
      ctx.log("warn", "codex stderr", { chunk: chunk.slice(0, 500) });
    });

    proc.onExit((code) => {
      // codex exec is one-shot per turn, like claude -p: every turn's
      // process exits by design, not just on error. A clean exit (code 0)
      // means the turn finished normally — the session is idle between
      // turns, not down (BUG-0008: this used to set healthy=false
      // unconditionally, so T1.9's heartbeat flagged status="error" +
      // adapter.down after *every* successful turn).
      if (code !== 0 && code !== null) {
        meta.healthy = false;
        ctx.emit({ type: "system", summary: `codex: process exited with code ${code}`, payload: { code } });
      }
      if (procs.get(sessionId) === proc) procs.delete(sessionId);
    });
  }

  /**
   * Version-pinning handshake (EPIC-P1 §3): runs `codex --version` and
   * compares it against `cfg.expectedVersion`, if configured. A mismatch
   * is a visible warning, never an abort — the session starts either way.
   */
  async function checkVersion(ctx: AdapterContext): Promise<void> {
    let output: string;
    try {
      const proc = await ctx.spawnWorker([cfg.command, "--version"]);
      output = await new Promise<string>((resolve) => {
        let buf = "";
        proc.onStdout((chunk) => (buf += chunk));
        proc.onExit(() => resolve(buf));
      });
    } catch (err) {
      ctx.emit({
        type: "system",
        summary: `codex: version handshake failed: ${err instanceof Error ? err.message : String(err)}`,
        payload: { kind: "codex.version_handshake_failed" },
      });
      return;
    }
    const version = output.trim().slice(0, 200);
    const mismatch = cfg.expectedVersion !== undefined && !version.includes(cfg.expectedVersion);
    ctx.emit({
      type: "system",
      summary: summarize(
        mismatch
          ? `codex: version mismatch — got "${version}", expected to contain "${cfg.expectedVersion}"`
          : `codex: handshake ${version || "(no version output)"}`,
      ),
      payload: { kind: "codex.version_handshake", version, expected: cfg.expectedVersion ?? null, mismatch },
    });
  }

  const adapter: Adapter = {
    id: "codex",
    version: "0.1.0",

    capabilities(): AdapterCapabilities {
      // cost: true (T1.11) — codex reports token usage, and pricing.ts
      // estimates a real $ figure from it whenever a session requests a
      // model (spec.model -> --model) that pricing.ts has a rate for.
      // Same honesty standard as reasoning:true above (claimed on the
      // CLI's documented capability, not "every session will have a
      // populated value"): a session that never sets spec.model, or sets
      // one pricing.ts doesn't know, gets no costUsd on its events at all
      // (R9.7 — unbekannt statt geraten, never a guess or a stale $0).
      //
      // usage: false (ADR-0004) — verified absent, not merely
      // unimplemented: no quota/rate-limit event exists anywhere in real
      // `codex exec --json` captures, and neither `codex login status`
      // nor `codex --help` expose any on-demand quota query under a
      // ChatGPT-plan login.
      return { reasoning: true, tools: true, cost: true, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "native",
        // ADR-0036: `codex --help`: "resume — Resume a previous interactive
        // session"; the adapter drives the same subcommand (index.ts spawn).
        resume: { argv: ["codex", "resume", "{sessionId}"], ref: "native" },
        features: {
          followUp: true,
          interrupt: true,
          // ADR-0018: codex exec never asks — tools run inside its sandbox.
          toolGate:
            cfg.sandbox === "danger-full-access" || cfg.extraArgs.includes("--dangerously-bypass-approvals-and-sandbox") ? "bypass" : "sandbox",
          questions: false,
          modelChoice: "start", modelSwitch: false, permissionModes: [],
          skills: false,
          agents: false,
          images: false,
          files: false,
          contextFork: false,
        } };
    },

    async start(spec: SessionSpec, ctx: AdapterContext): Promise<SessionHandle> {
      const meta: SessionMeta = { healthy: true, degraded: false, model: spec.model ?? cfg.model };
      // T1.5-10/ADR-0005: codex has no project-local skill/agent mechanism
      // (`codex plugin list` is a global, project-independent marketplace,
      // structurally unrelated to a target repo's own .claude/skills —
      // verified against the real CLI). A requested skill/agent must be
      // visibly ignored, never silently swallowed (AGENTS.md Regel 6).
      // A hub-resolved skillChain is already in the prompt, so that skill
      // is not reported as ignored.
      const requestedArgs = spec.args as { skill?: unknown; agent?: unknown; skillChain?: unknown } | undefined;
      const chainApplied = Array.isArray(requestedArgs?.skillChain) && requestedArgs.skillChain.length > 0;
      const ignored: { skill?: unknown; agent?: unknown } = {};
      if (requestedArgs?.agent) ignored.agent = requestedArgs.agent;
      if (requestedArgs?.skill && !chainApplied) ignored.skill = requestedArgs.skill;
      if (ignored.skill !== undefined || ignored.agent !== undefined) {
        ctx.emit({
          type: "system",
          summary: "codex: skill/agent selection ignored — no project-local skill/agent mechanism exists for this adapter",
          payload: { kind: "codex.skill_agent_ignored", requested: ignored },
        });
      }
      await checkVersion(ctx);
      const proc = await ctx.spawnWorker(
        buildInitialArgs(spec.prompt ?? "", spec.model ?? cfg.model),
        spec.env ? { env: spec.env } : undefined,
      );
      attach(ctx.sessionId, proc, ctx, meta);
      const handle: SessionHandle = {
        sessionId: ctx.sessionId,
        ...(proc.pid !== undefined ? { pid: proc.pid } : {}),
      };
      return handle;
    },

    async steer(handle: SessionHandle, input: SteerInput, ctx: AdapterContext): Promise<Ack> {
      const meta = sessions.get(handle.sessionId);
      switch (input.kind) {
        case "prompt": {
          // codex exec is one-shot per process, like claude -p — steering
          // means spawning a fresh process resumed via `exec resume`.
          if (!meta?.threadId) {
            return { ok: false, detail: "codex: no thread_id captured yet — cannot resume" };
          }
          const proc = await ctx.spawnWorker(buildResumeArgs(meta.threadId, input.text, meta.model));
          attach(handle.sessionId, proc, ctx, meta);
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
          return { ok: false, detail: "codex: Modus und Modell lassen sich in dieser Session nicht wechseln" };
        case "resume":
          // Same honest limitation as the claude adapter: codex exec has
          // no bare "continue without a new prompt" mode either.
          return { ok: false, detail: "codex: resume needs a prompt — steer with kind: 'prompt' instead" };
      }
    },

    async status(handle: SessionHandle): Promise<HealthReport> {
      const meta = sessions.get(handle.sessionId);
      if (!meta) return { state: "down", detail: "no live process" };
      // BUG-0008: `degraded` used to be checked before `healthy`, so once
      // ANY unhandled event was ever seen, this permanently reported
      // "degraded" for the rest of the session's life — masking a real
      // subsequent abnormal exit behind a lesser label, and making it
      // invisible to the heartbeat (packages/core/src/modules/sessions/session-manager.ts's
      // runHeartbeat only acts on "down"/"broken", never "degraded").
      // `healthy` now takes priority: a genuinely dead/crashed process is
      // reported "down" even if it was also degraded earlier.
      if (!meta.healthy) return { state: "down", detail: "process exited abnormally", lastSeen: new Date().toISOString() };
      if (meta.degraded) {
        return { state: "degraded", detail: "unhandled stream-json event seen", lastSeen: new Date().toISOString() };
      }
      return { state: "healthy", lastSeen: new Date().toISOString() };
    },

    /** ADR-0014: after a hub restart, take over the turn that is still
     * running, or continue natively with the next prompt. */
    async recover(sessionId: string, _lastSeq: number, ctx: AdapterContext): Promise<SessionHandle | null> {
      const native = ctx.nativeSessionId ?? undefined;
      const proc = (await ctx.adoptWorker?.()) ?? null;
      if (!proc && !native) return null;
      const meta: SessionMeta = { healthy: true, degraded: false, ...(native ? { threadId: native } : {}) };
      if (proc) attach(sessionId, proc, ctx, meta);
      else sessions.set(sessionId, meta);
      return { sessionId, ...(proc?.pid !== undefined ? { pid: proc.pid } : {}) };
    },

    async stop(handle: SessionHandle): Promise<void> {
      await procs.get(handle.sessionId)?.kill("SIGTERM");
      procs.delete(handle.sessionId);
      sessions.delete(handle.sessionId);
    },

    // No recover(): same reasoning as the claude adapter — codex sessions
    // are real CLI processes, not resumable in-place after a hub crash
    // without re-attaching to a live tmux pane. Absence is honest for P1.
  };

  return adapter;
}
