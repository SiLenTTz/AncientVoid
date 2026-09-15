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
import { normalizeClaudeLine } from "./normalize.ts";

/**
 * claude adapter (P1 reference/"golden path"). Spawns the real CLI via
 * ctx.spawnWorker (never child_process directly — AdapterContext rule) and
 * maps its stream-json output through normalize.ts.
 *
 * Config (hub.config.json -> adapters[].config):
 *   command:   executable to spawn (default "claude") — override in tests
 *              to avoid invoking the real CLI.
 *   extraArgs: extra CLI args appended verbatim (e.g. ["--model", "opus"]).
 */

const ClaudeConfig = z.object({
  command: z.string().min(1).default("claude"),
  extraArgs: z.array(z.string()).default([]),
});
type ClaudeConfig = z.infer<typeof ClaudeConfig>;

/**
 * T1.5-10/ADR-0005: `SessionSpec.args`' own adapter-specific free-form
 * slot, validated here — no contract change needed. `skill` -> a
 * `/name` prefix in the prompt text (verified live: works in `-p` mode,
 * applies per-turn, so it's reapplied on every steer(prompt) too — see
 * `meta.skill` below). `agent` -> the `--agent <name>` CLI flag (verified
 * live: sets the whole session's persona) — deliberately only applied on
 * the INITIAL spawn, never re-added on a `--resume`, since ADR-0005 left
 * whether `--agent` still does anything on a resumed process explicitly
 * unverified.
 */
const ClaudeSessionArgs = z
  .object({
    skill: z.string().min(1).optional(),
    agent: z.string().min(1).optional(),
  })
  .optional();

interface SessionMeta {
  resumeSessionId?: string;
  healthy: boolean;
  degraded: boolean;
  /** Reapplied to every prompt (initial and steer) — a skill choice is
   * fixed for the session's whole lifetime, not re-selectable per turn
   * (no SteerInput channel carries one; ADR-0005 deliberately didn't add
   * one). */
  skill?: string | undefined;
}

export function createAdapter(config?: Readonly<Record<string, unknown>>): Adapter {
  const cfg: ClaudeConfig = ClaudeConfig.parse(config ?? {});
  const procs = new Map<string, WorkerProcess>();
  const sessions = new Map<string, SessionMeta>();

  /** `agent` is only ever passed on the initial (non-resume) spawn — see
   * ClaudeSessionArgs' doc comment for why. `skill` is applied by the
   * caller wrapping `prompt` before calling this (applies to every turn). */
  function buildArgs(prompt: string, resumeSessionId?: string, agent?: string): string[] {
    const args = ["-p", prompt, "--output-format", "stream-json", "--verbose"];
    if (resumeSessionId) args.push("--resume", resumeSessionId);
    if (agent && !resumeSessionId) args.push("--agent", agent);
    return [cfg.command, ...args, ...cfg.extraArgs];
  }

  function withSkill(prompt: string, skill: string | undefined): string {
    return skill ? `/${skill}\n\n${prompt}` : prompt;
  }

  /** Wires a spawned claude process's stdout/stderr/exit into ctx.emit(). */
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
            summary: "claude: non-JSON stdout line",
            payload: { line: rawLine.slice(0, 500) },
          });
          continue;
        }
        if (parsed && typeof parsed === "object" && "session_id" in parsed) {
          const sid = (parsed as { session_id?: unknown }).session_id;
          if (typeof sid === "string") meta.resumeSessionId = sid;
        }
        for (const event of normalizeClaudeLine(parsed)) ctx.emit(event);
      }
    });

    proc.onStderr((chunk) => {
      ctx.log("warn", "claude stderr", { chunk: chunk.slice(0, 500) });
    });

    proc.onExit((code) => {
      // Drop the dead process reference (procs), but keep `meta` — it
      // carries resumeSessionId, which the *next* steer(prompt) needs.
      // claude -p is one-shot: every turn's process exits by design, not
      // just on error — a clean exit (code 0) means the turn finished
      // normally and the session is simply idle between turns, NOT down.
      // Only an abnormal exit means the adapter is actually unhealthy
      // (BUG-0008: this used to set healthy=false unconditionally, so
      // T1.9's heartbeat flagged status="error" + adapter.down after
      // *every* successful turn — caught via a real end-to-end claude run,
      // never by the heartbeat's own test, which used a synthetic adapter
      // that never modeled one-shot-per-turn exit semantics).
      if (code !== 0 && code !== null) {
        meta.healthy = false;
        ctx.emit({ type: "system", summary: `claude: process exited with code ${code}`, payload: { code } });
      }
      if (procs.get(sessionId) === proc) procs.delete(sessionId);
    });
  }

  const adapter: Adapter = {
    id: "claude",
    version: "0.1.0",

    capabilities(): AdapterCapabilities {
      // usage: true (ADR-0004) — claude's stream carries a real
      // rate_limit_event with unifiedWindows utilization/resetsAt,
      // verified against real captures (normalize.ts).
      return { reasoning: true, tools: true, cost: true, steer: true, usage: true };
    },

    async start(spec: SessionSpec, ctx: AdapterContext): Promise<SessionHandle> {
      const args = ClaudeSessionArgs.safeParse(spec.args);
      const skill = args.success ? args.data?.skill : undefined;
      const agentPersona = args.success ? args.data?.agent : undefined;
      const meta: SessionMeta = { healthy: true, degraded: false, skill };
      const proc = await ctx.spawnWorker(
        buildArgs(withSkill(spec.prompt ?? "", skill), undefined, agentPersona),
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
          // claude -p is one-shot per process — steering means spawning a
          // fresh process resumed via --resume <session_id>. The
          // session's skill (if any) is reapplied to every turn; --agent
          // is deliberately NOT re-added here (see buildArgs' doc comment).
          const proc = await ctx.spawnWorker(
            buildArgs(withSkill(input.text, meta?.skill), meta?.resumeSessionId),
          );
          attach(handle.sessionId, proc, ctx, meta ?? { healthy: true, degraded: false });
          return { ok: true };
        }
        case "stop":
          await adapter.stop(handle, ctx);
          return { ok: true };
        case "park": {
          await procs.get(handle.sessionId)?.kill("SIGTERM");
          return { ok: true };
        }
        case "resume":
          // claude has no bare "continue without a new prompt" mode in
          // print mode — resuming needs a prompt. Honest no rather than a
          // fake success (capabilities() must not promise more than this
          // holds).
          return { ok: false, detail: "claude: resume needs a prompt — steer with kind: 'prompt' instead" };
      }
    },

    async status(handle: SessionHandle): Promise<HealthReport> {
      const meta = sessions.get(handle.sessionId);
      if (!meta) return { state: "down", detail: "no live process" };
      if (meta.degraded) {
        return { state: "degraded", detail: "unhandled stream-json event seen", lastSeen: new Date().toISOString() };
      }
      return { state: meta.healthy ? "healthy" : "down", lastSeen: new Date().toISOString() };
    },

    async stop(handle: SessionHandle): Promise<void> {
      await procs.get(handle.sessionId)?.kill("SIGTERM");
      procs.delete(handle.sessionId);
      sessions.delete(handle.sessionId);
    },

    // No recover(): claude sessions are real CLI processes, not resumable
    // in-place after a hub crash without re-attaching to a live tmux pane.
    // Absence is the honest answer for P1 — a wrong recover() would be
    // worse than none (contract marks it optional for exactly this case).
  };

  return adapter;
}
