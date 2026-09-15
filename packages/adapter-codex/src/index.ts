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
} from "@uacc/contracts";
import { normalizeCodexLine, summarize } from "./normalize.ts";

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
  expectedVersion: z.string().optional(),
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
          if (typeof tid === "string") meta.threadId = tid;
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
    let output = "";
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
      return { reasoning: true, tools: true, cost: true, steer: true };
    },

    async start(spec: SessionSpec, ctx: AdapterContext): Promise<SessionHandle> {
      const meta: SessionMeta = { healthy: true, degraded: false, model: spec.model };
      await checkVersion(ctx);
      const proc = await ctx.spawnWorker(
        buildInitialArgs(spec.prompt ?? "", spec.model),
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
      // invisible to the heartbeat (packages/core/src/sessionmanager.ts's
      // runHeartbeat only acts on "down"/"broken", never "degraded").
      // `healthy` now takes priority: a genuinely dead/crashed process is
      // reported "down" even if it was also degraded earlier.
      if (!meta.healthy) return { state: "down", detail: "process exited abnormally", lastSeen: new Date().toISOString() };
      if (meta.degraded) {
        return { state: "degraded", detail: "unhandled stream-json event seen", lastSeen: new Date().toISOString() };
      }
      return { state: "healthy", lastSeen: new Date().toISOString() };
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
