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
import { normalizeCopilotLine, extractResultSessionId } from "./normalize.ts";

/**
 * GitHub Copilot CLI adapter (P3, T3.4). Spawns the real, installed
 * `copilot` CLI (verified live, 2026-09-18, v1.0.86, already authenticated
 * on this machine — no login flow needed) via ctx.spawnWorker, maps its
 * real `--output-format json` JSONL stream through normalize.ts.
 *
 * Real, verified flags (`copilot --help`, live captures):
 *   -p/--prompt          non-interactive single prompt, exits after
 *   --output-format json JSONL, one JSON object per line
 *   --allow-all-tools    required for non-interactive mode (else it would
 *                        block on an interactive permission prompt — same
 *                        class of footgun as adapter-aider's OAuth hang,
 *                        confirmed via --help text: "required for
 *                        non-interactive mode")
 *   -r/--resume <id>     resume a previous session by id; verified live —
 *                        the real session id survives a resume unchanged
 *                        and the resumed run sees prior conversation state
 *   --model <model>      real per-run model override; an unknown model
 *                        name fails fast with a plain-text stderr line and
 *                        exit code 1 (verified live), never silently
 *                        falls back
 *   --agent <agent>      real custom-agent selection, directly analogous
 *                        to claude's/opencode's --agent
 *
 * `--allow-all-tools` is passed unconditionally, same reasoning as
 * adapter-claude's `--dangerously-skip-permissions` default: the hub's own
 * approval-class system (ADR-0007) is the real gate, not the CLI's
 * interactive prompt, which would otherwise just hang forever with no
 * stdin attached (ctx.spawnWorker never wires a TTY).
 */

const CopilotConfig = z.object({
  command: z.string().min(1).default("copilot"),
  extraArgs: z.array(z.string()).default([]),
});
type CopilotConfig = z.infer<typeof CopilotConfig>;

const CopilotSessionArgs = z
  .object({
    agent: z.string().min(1).optional(),
  })
  .optional();

interface SessionMeta {
  resumeSessionId?: string;
  healthy: boolean;
}

export function createAdapter(config?: Readonly<Record<string, unknown>>): Adapter {
  const cfg: CopilotConfig = CopilotConfig.parse(config ?? {});
  const procs = new Map<string, WorkerProcess>();
  const sessions = new Map<string, SessionMeta>();

  /** `agent`/`model` only on the initial (non-resume) spawn — whether
   * either still applies across a `-r <id>`-continued run is unverified,
   * same caution as adapter-opencode's buildArgs. */
  function buildArgs(prompt: string, resumeSessionId?: string, agent?: string, model?: string): string[] {
    const args = [cfg.command, "-p", prompt, "--output-format", "json", "--allow-all-tools"];
    if (resumeSessionId) args.push("-r", resumeSessionId);
    if (agent && !resumeSessionId) args.push("--agent", agent);
    if (model && !resumeSessionId) args.push("--model", model);
    return [...args, ...cfg.extraArgs];
  }

  function attach(sessionId: string, proc: WorkerProcess, ctx: AdapterContext, meta: SessionMeta): void {
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
            summary: "copilot: non-JSON stdout line",
            payload: { line: rawLine.slice(0, 500) },
          });
          continue;
        }
        const resultSessionId = extractResultSessionId(parsed);
        if (resultSessionId && resultSessionId !== meta.resumeSessionId) {
          meta.resumeSessionId = resultSessionId;
          // ADR-0014: the hub records the id so recover() can resume.
          ctx.emit({
            type: "system",
            summary: `Copilot · Session ${resultSessionId}`,
            payload: { kind: "copilot.native_session", nativeSessionId: resultSessionId },
          });
        }
        for (const event of normalizeCopilotLine(parsed)) ctx.emit(event);
      }
    });

    proc.onStderr((chunk) => {
      // Real, verified: an unrecoverable failure (e.g. an unknown --model)
      // prints a plain "Error: ..." line to stderr and exits non-zero —
      // never mixed into the JSON stdout stream. Surfaced as a visible
      // system event, not just a log line, so it reaches the session tail.
      const text = chunk.trim();
      if (text) {
        ctx.emit({ type: "system", summary: `copilot: stderr — ${text.slice(0, 180)}`, payload: { stderr: text.slice(0, 500) } });
      }
    });

    proc.onExit((code) => {
      if (code !== 0 && code !== null) {
        meta.healthy = false;
        ctx.emit({ type: "system", summary: `copilot: process exited with code ${code}`, payload: { code } });
      }
      if (procs.get(sessionId) === proc) procs.delete(sessionId);
    });
  }

  const adapter: Adapter = {
    id: "copilot",
    version: "0.1.0",

    capabilities(): AdapterCapabilities {
      // cost: false — no dollar figure anywhere in the real capture, only
      // a "premium requests" count (ADR-0003 honesty: don't invent a $).
      // usage: false — session.usage_checkpoint has no fraction-of-quota +
      // resetsAt (ADR-0004's UsageQuota shape), only cumulative raw
      // counters — R9.7, not guessed into the wrong shape.
      return { reasoning: false, tools: true, cost: false, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "native", features: { followUp: true, interrupt: true, toolGate: "bypass", questions: false, modelChoice: "start", skills: false, agents: true, images: false, files: false, contextFork: false } };
    },

    async start(spec: SessionSpec, ctx: AdapterContext): Promise<SessionHandle> {
      const args = CopilotSessionArgs.safeParse(spec.args);
      const agent = args.success ? args.data?.agent : undefined;
      const meta: SessionMeta = { healthy: true };
      const proc = await ctx.spawnWorker(
        buildArgs(spec.prompt ?? "", undefined, agent, spec.model),
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
          const proc = await ctx.spawnWorker(buildArgs(input.text, meta?.resumeSessionId));
          attach(handle.sessionId, proc, ctx, meta ?? { healthy: true });
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
          return { ok: false, detail: "copilot: resume needs a prompt — steer with kind: 'prompt' instead" };
      }
    },

    async status(handle: SessionHandle): Promise<HealthReport> {
      const meta = sessions.get(handle.sessionId);
      if (!meta) return { state: "down", detail: "no live process" };
      return { state: meta.healthy ? "healthy" : "down", lastSeen: new Date().toISOString() };
    },

    /** ADR-0014: after a hub restart, take over the turn that is still
     * running, or continue natively with the next prompt. */
    async recover(sessionId: string, _lastSeq: number, ctx: AdapterContext): Promise<SessionHandle | null> {
      const native = ctx.nativeSessionId ?? undefined;
      const proc = (await ctx.adoptWorker?.()) ?? null;
      if (!proc && !native) return null;
      const meta: SessionMeta = { healthy: true, ...(native ? { resumeSessionId: native } : {}) };
      if (proc) attach(sessionId, proc, ctx, meta);
      else sessions.set(sessionId, meta);
      return { sessionId, ...(proc?.pid !== undefined ? { pid: proc.pid } : {}) };
    },

    async stop(handle: SessionHandle): Promise<void> {
      await procs.get(handle.sessionId)?.kill("SIGTERM");
      procs.delete(handle.sessionId);
      sessions.delete(handle.sessionId);
    },

    // No recover(): same reasoning as adapter-claude/adapter-opencode — a
    // real CLI process, not resumable in-place after a hub crash. A fresh
    // steer(prompt) after restart still works via the real `-r
    // <sessionId>` once meta.resumeSessionId round-trips through recover
    // logic at the SessionManager layer, same limitation those adapters
    // already document.
  };

  return adapter;
}
