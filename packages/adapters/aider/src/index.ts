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
 * aider adapter (P3, T3.13). Real, verified installation gap and CLI
 * shape — but genuinely **unproven** end to end, honestly, for a concrete
 * reason spelled out below rather than glossed over.
 *
 * Real finds while building this (2026-09-18):
 * 1. `aider-chat` failed to even run `--version` on this machine's Python
 *    3.13 — `aider.commands` unconditionally imports `aider.voice`, which
 *    imports `pydub`, which imports `audioop` — removed from the stdlib in
 *    Python 3.13 (PEP 594). Fixed by installing the `audioop-lts` compat
 *    shim alongside it (`uv tool install aider-chat --with audioop-lts`).
 *    This is an environment note for whoever deploys this adapter, not
 *    something this code can paper over.
 * 2. Real, verified via `aider --help`: one-shot mode is `--message
 *    <text>` ("process reply then exit, disables chat mode") — no
 *    `--format json` or any structured-output flag exists. aider is a
 *    plain-text terminal tool; there is no fine-grained tool_use/
 *    tool_result event stream to normalize the way claude/codex/opencode
 *    have, only a stdout blob per turn — hence no separate normalize.ts.
 * 3. Real, verified live: running aider with **no model configured**
 *    doesn't fail loud — it silently starts an interactive OpenRouter
 *    OAuth flow and waits up to 5 minutes for a browser callback. That is
 *    a real, dangerous default for a headless hub adapter (a session
 *    would just hang looking "starting" for 5 minutes). This adapter
 *    therefore *requires* `spec.model` and refuses to spawn without one —
 *    fail loud immediately instead of risking that hang.
 * 4. No API key for any provider is configured in this environment, so a
 *    real successful LLM turn could not be captured — unlike
 *    claude/codex/opencode, this adapter's happy path is **not** verified
 *    against real output, only its documented CLI shape and its real
 *    no-model failure mode. Marked `unproven` in the README/epic
 *    accordingly — this is not a guess dressed up as tested.
 *
 * Config (hub.config.json -> adapters[].config):
 *   command:   executable to spawn (default "aider").
 *   extraArgs: extra CLI args appended verbatim.
 */

const AiderConfig = z.object({
  command: z.string().min(1).default("aider"),
  extraArgs: z.array(z.string()).default([]),
});
type AiderConfig = z.infer<typeof AiderConfig>;

interface SessionMeta {
  healthy: boolean;
}

export function createAdapter(config?: Readonly<Record<string, unknown>>): Adapter {
  const cfg: AiderConfig = AiderConfig.parse(config ?? {});
  const procs = new Map<string, WorkerProcess>();
  const sessions = new Map<string, SessionMeta>();

  function buildArgs(prompt: string, model: string): string[] {
    return [
      cfg.command,
      "--message",
      prompt,
      "--model",
      model,
      "--yes-always",
      "--no-pretty",
      "--no-stream",
      ...cfg.extraArgs,
    ];
  }

  function attach(sessionId: string, proc: WorkerProcess, ctx: AdapterContext, meta: SessionMeta): void {
    meta.healthy = true;
    procs.set(sessionId, proc);
    sessions.set(sessionId, meta);

    // No structured stream exists (see doc comment point 2) — the whole
    // turn's stdout becomes one assistant event once the process exits,
    // rather than guessing at line-by-line structure that was never
    // actually observed.
    let stdout = "";
    proc.onStdout((chunk) => {
      stdout += chunk;
    });
    proc.onStderr((chunk) => {
      ctx.log("warn", "aider stderr", { chunk: chunk.slice(0, 500) });
    });
    proc.onExit((code) => {
      if (stdout.trim()) {
        ctx.emit({ type: "assistant", summary: stdout.trim().slice(0, 200), payload: { text: stdout.trim() } });
      }
      if (code !== 0 && code !== null) {
        meta.healthy = false;
        ctx.emit({ type: "system", summary: `aider: process exited with code ${code}`, payload: { code } });
      }
      if (procs.get(sessionId) === proc) procs.delete(sessionId);
    });
  }

  const adapter: Adapter = {
    id: "aider",
    version: "0.1.0",

    capabilities(): AdapterCapabilities {
      // cost/usage: false — no structured signal for either was ever
      // observed (see doc comment point 4), not guessed as present.
      return { reasoning: false, tools: true, cost: false, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none", features: { followUp: false, interrupt: true, toolGate: "bypass", questions: false, modelChoice: "start", modelSwitch: false, permissionModes: [], skills: false, agents: false, images: false, files: false, contextFork: false } };
    },

    async start(spec: SessionSpec, ctx: AdapterContext): Promise<SessionHandle> {
      // Point 3: refuse to risk the 5-minute OAuth hang. A real,
      // named failure now beats a session that silently sits at
      // "starting" for five minutes with no visible cause.
      if (!spec.model) {
        ctx.emit({
          type: "system",
          summary: "aider: refused to start — no model configured (would otherwise hang on an interactive OAuth prompt)",
          payload: { kind: "aider.missing_model" },
        });
        throw new Error("aider adapter requires SessionSpec.model (e.g. \"anthropic/claude-sonnet-5\")");
      }
      const meta: SessionMeta = { healthy: true };
      const proc = await ctx.spawnWorker(
        buildArgs(spec.prompt ?? "", spec.model),
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
      switch (input.kind) {
        case "prompt": {
          // Unverified whether aider's own on-disk chat history picks up
          // context across separate --message invocations in the same
          // directory (point 4) — documented honestly, not assumed.
          return { ok: false, detail: "aider: steer(prompt) is unverified (no live model access in this environment) — not wired up" };
        }
        case "stop":
          await adapter.stop(handle, ctx);
          return { ok: true };
        case "park": {
          await procs.get(handle.sessionId)?.kill("SIGTERM");
          return { ok: true };
        }
        case "configure":
          return { ok: false, detail: "aider: Modus und Modell lassen sich in dieser Session nicht wechseln" };
        case "resume":
          return { ok: false, detail: "aider: resume needs a prompt — steer with kind: 'prompt' instead" };
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
