import { z } from "zod";
import type {
  Adapter,
  AdapterCapabilities,
  AdapterContext,
  Ack,
  HealthReport,
  ModelOption,
  PromptAttachment,
  SessionHandle,
  SessionSpec,
  SteerInput,
  WorkerProcess,
} from "@uacc/contracts";
import { promptWithAttachments } from "@uacc/contracts";
import { normalizeClaudeLine } from "./normalize.ts";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * claude adapter (P1 reference/"golden path"). Spawns the real CLI via
 * ctx.spawnWorker (never child_process directly — AdapterContext rule) and
 * maps its stream-json output through normalize.ts.
 *
 * Config (hub.config.json -> adapters[].config):
 *   command:   executable to spawn (default "claude") — override in tests
 *              to avoid invoking the real CLI.
 *   extraArgs: extra CLI args appended verbatim (e.g. ["--model", "opus"]).
 *   permissionPrompts: "hub" (default) — every tool that needs a decision
 *              is asked through the hub's permission bridge (ADR-0018 §3,
 *              `--permission-prompt-tool`); "off" — claude's own settings
 *              decide and anything that would ask is denied.
 */

const ClaudeConfig = z.object({
  command: z.string().min(1).default("claude"),
  extraArgs: z.array(z.string()).default([]),
  /** ADR-0033: adapter-wide fallback when neither the hub nor the session names a mode. */
  permissionMode: z.string().min(1).optional(),
  permissionPrompts: z.enum(["hub", "off"]).default("hub"),
  /** ADR-0032: context window of the models this instance runs (tokens),
   * configured — claude does not report it in band. */
  contextWindowTokens: z.number().int().positive().optional(),
  /** Where Claude Code keeps its transcripts (~/.claude by default) — the
   * continued run's history is imported from there into the hub's tail. */
  claudeDir: z.string().min(1).optional(),
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
    resumeSessionId: z.string().min(1).optional(),
    /** ADR-0040: continue the resumed session as a copy with its own id (`--fork-session`),
     * for a run that is still open in another harness. First turn only. */
    forkSession: z.boolean().optional(),
    /** ADR-0033: one of PERMISSION_MODES. */
    permissionMode: z.string().min(1).optional(),
  })
  .optional();

/** ADR-0033: `claude --permission-mode` choices (2.1.288). */
const PERMISSION_MODES = ["auto", "manual", "plan", "acceptEdits", "dontAsk", "bypassPermissions"] as const;

interface SessionMeta {
  resumeSessionId?: string;
  /** ADR-0033: reapplied to every turn, changeable through `configure`. */
  permissionMode?: string | undefined;
  model?: string | undefined;
  /** ADR-0040: the next turn forks the resumed session; cleared once it ran. */
  forkNext?: boolean | undefined;
  healthy: boolean;
  degraded: boolean;
  /** Reapplied to every prompt (initial and steer) — a skill choice is
   * fixed for the session's whole lifetime, not re-selectable per turn
   * (no SteerInput channel carries one; ADR-0005 deliberately didn't add
   * one). */
  skill?: string | undefined;
}

/** ADR-0018: flags with which claude runs every tool unasked. */
function bypassesPermissions(args: readonly string[]): boolean {
  const mode = args.indexOf("--permission-mode");
  return (
    args.includes("--dangerously-skip-permissions") ||
    args.includes("--allow-dangerously-skip-permissions") ||
    (mode >= 0 && args[mode + 1] === "bypassPermissions")
  );
}

export function createAdapter(config?: Readonly<Record<string, unknown>>): Adapter {
  const cfg: ClaudeConfig = ClaudeConfig.parse(config ?? {});
  const procs = new Map<string, WorkerProcess>();
  const sessions = new Map<string, SessionMeta>();

  /** `agent`/`model` are only ever passed on the initial (non-resume)
   * spawn — see ClaudeSessionArgs' doc comment for `agent`; `model` follows
   * the same reasoning (T1.6-6: a resumed process already has its model
   * fixed, `claude --resume` doesn't accept switching it mid-session).
   * `skill` is applied by the caller wrapping `prompt` before calling this
   * (applies to every turn). */
  const askHub = cfg.permissionPrompts === "hub" && !bypassesPermissions(cfg.extraArgs);

  /** ADR-0018 §3: route permission prompts to the hub, when it offers a
   * bridge. Without one (a hub that doesn't), say so in the tail. */
  async function permissionArgs(ctx: AdapterContext): Promise<string[]> {
    if (!askHub) return [];
    const bridge = await ctx.permissionBridge?.();
    if (!bridge) {
      ctx.emit({ type: "system", summary: "claude: keine Freigabe-Brücke — Tools, die fragen müssten, werden abgelehnt", payload: { kind: "claude.no_permission_bridge" } });
      return [];
    }
    return ["--mcp-config", bridge.mcpConfigPath, "--permission-prompt-tool", bridge.toolName];
  }

  /** A human may take minutes to answer — claude must not give up on the
   * bridge's tool call before the hub's own timeout does. */
  function workerEnv(env: Record<string, string> | undefined): { env: Record<string, string> } | undefined {
    return askHub ? { env: { ...env, MCP_TOOL_TIMEOUT: String(60 * 60_000) } } : env ? { env } : undefined;
  }

  function buildArgs(
    prompt: string,
    resumeSessionId?: string,
    agent?: string,
    model?: string,
    extra: string[] = [],
    mode?: string,
    modelOnResume = false,
    fork = false,
  ): string[] {
    const args = ["-p", prompt, "--output-format", "stream-json", "--verbose", ...extra];
    if (resumeSessionId) args.push("--resume", resumeSessionId);
    if (resumeSessionId && fork) args.push("--fork-session");
    if (agent && !resumeSessionId) args.push("--agent", agent);
    if (model && (!resumeSessionId || modelOnResume)) args.push("--model", model);
    // ADR-0033: the session's mode beats an operator's --permission-mode in extraArgs.
    let tail = cfg.extraArgs;
    if (mode) {
      args.push("--permission-mode", mode);
      tail = tail.filter((a, i, all) => a !== "--permission-mode" && all[i - 1] !== "--permission-mode");
    }
    return [cfg.command, ...args, ...tail];
  }

  function withSkill(prompt: string, skill: string | undefined): string {
    return skill ? `/${skill}\n\n${prompt}` : prompt;
  }

  /** T7.10: claude reads images and PDFs itself (Read tool) — it gets the
   * path and access to the folder; other files come with their text. */
  function withAttachments(prompt: string, attachments: readonly PromptAttachment[] | undefined): { prompt: string; dirs: string[] } {
    if (!attachments?.length) return { prompt, dirs: [] };
    const native = new Set(attachments.filter((a) => a.kind === "image" || a.kind === "pdf").map((a) => a.id));
    const dirs = [...new Set(attachments.map((a) => a.path.slice(0, a.path.lastIndexOf("/"))))];
    return { prompt: promptWithAttachments(prompt, attachments, native), dirs };
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
          // Claude CLI prints some failures as plain text (not stream-json),
          // e.g. "Error: No deferred tool marker found in the resumed session…"
          // Surface those READABLY instead of a cryptic "non-JSON stdout line".
          const text = rawLine.trim();
          if (text.startsWith("Error:")) {
            const resumeStale = text.includes("No deferred tool marker found");
            ctx.emit({
              type: "system",
              summary: resumeStale
                ? "claude: Resume fehlgeschlagen — die Session hatte eine offene (verwaiste) Tool-Freigabe. Neue Nachricht senden oder Session neu starten."
                : `claude: CLI-Fehler — ${text.slice(0, 200)}`,
              payload: { kind: "claude.cli_error", resumeStale, line: text.slice(0, 500) },
            });
          } else {
            ctx.emit({
              type: "system",
              summary: "claude: non-JSON stdout line",
              payload: { line: rawLine.slice(0, 500) },
            });
          }
          continue;
        }
        if (parsed && typeof parsed === "object" && "session_id" in parsed) {
          const sid = (parsed as { session_id?: unknown }).session_id;
          if (typeof sid === "string" && sid !== meta.resumeSessionId) {
            meta.resumeSessionId = sid;
            ctx.emit({
              type: "system",
              summary: `Claude · Session ${sid}`,
              payload: { kind: "claude.native_session", nativeSessionId: sid },
            });
          }
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
      return {
        reasoning: true,
        tools: true,
        cost: true,
        steer: true,
        usage: true,
        ...(cfg.contextWindowTokens !== undefined ? { contextWindowTokens: cfg.contextWindowTokens } : {}),
        nativeDiscovery: "none",
        nativeResume: "native",
        // ADR-0036: `claude --help`: "--resume <session-id>, continues that
        // session" — same flag this adapter itself spawns (start --resume),
        // and the one PcOpenNotice showed live (ADR-0034).
        resume: { argv: ["claude", "--resume", "{sessionId}"], ref: "native" },
        // ADR-0042 (EPIC-P25): documented — headless `-p` evaluates slash
        // prompts, picker-based commands excluded (code.claude.com/docs/en/
        // headless + /en/commands: /clear, /compact are argument-based, not
        // pickers). Live verification per CLI is T25.6; until then this is
        // the documented level, honestly marked in docs/adapters.md.
        commands: [
          { name: "/clear", description: "Gesprächsverlauf leeren — neuer Kontext in derselben Session", scope: "both" },
          { name: "/compact", description: "Kontext komprimieren, optional mit Anleitung als Text", scope: "both" },
        ],
        // ADR-0018. Hub prompts: every tool that needs a decision is asked
        // on the phone (native). Off: `claude -p` denies every tool that
        // would ask — a fixed list (settings/--allowedTools), nobody asked.
        features: {
          followUp: true,
          interrupt: true,
          toolGate: bypassesPermissions(cfg.extraArgs) ? "bypass" : askHub ? "native" : "allowlist",
          questions: askHub,
          modelChoice: "start", modelSwitch: true, permissionModes: PERMISSION_MODES,
          skills: true,
          agents: true,
          images: true,
          files: true,
          contextFork: false,
        },
      };
    },

    /** ADR-0018: the aliases `claude --help` names (2.1.280) — each
     * resolves to the latest model of that line. */
    async models(): Promise<ModelOption[]> {
      return [
        { id: "fable", label: "Fable" },
        { id: "opus", label: "Opus" },
        { id: "sonnet", label: "Sonnet" },
        { id: "haiku", label: "Haiku" },
      ];
    },

    async start(spec: SessionSpec, ctx: AdapterContext): Promise<SessionHandle> {
      const args = ClaudeSessionArgs.safeParse(spec.args);
      const skill = args.success ? args.data?.skill : undefined;
      const agentPersona = args.success ? args.data?.agent : undefined;
      const resumeSessionId = args.success ? args.data?.resumeSessionId : undefined;
      if (resumeSessionId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resumeSessionId)) {
        // Live-Fund 2026-09-28: adopting a subagent transcript sent
        // `agent-…` as the resume id — the CLI dies with exit 1 and an
        // opaque stdout error. Fail loudly before spawning anything.
        throw new Error(`Claude kann „${resumeSessionId}" nicht fortsetzen — keine Session-ID (UUID). Subagent-Verläufe gehören zu ihrer Haupt-Session.`);
      }
      const permissionMode = args.success ? (args.data?.permissionMode ?? cfg.permissionMode) : cfg.permissionMode;
      const forkNext = Boolean(resumeSessionId && args.success && args.data?.forkSession);
      const meta: SessionMeta = { healthy: true, degraded: false, skill, permissionMode, model: spec.model, forkNext, ...(resumeSessionId ? { resumeSessionId } : {}) };
      const att = withAttachments(spec.prompt ?? "", spec.attachments);
      // Where the continued conversation happened: its transcript becomes
      // the hub's history, so the phone shows where the run stands without
      // asking the agent first. Awaited — history before the new turn.
      if (resumeSessionId) await importTranscript(ctx, spec.project, resumeSessionId, cfg.claudeDir);
      if (resumeSessionId && !spec.prompt?.trim() && !spec.attachments?.length) {
        // ADR-0040: an adoption without a first prompt has no turn. `claude -p ""
        // --resume` is not "just open it" — it looks for a deferred tool call and
        // dies with "No deferred tool marker" (live 2026-10-27). Idle between
        // turns, like recover(): the next steer resumes (and forks, if asked).
        sessions.set(ctx.sessionId, meta);
        return { sessionId: ctx.sessionId };
      }
      meta.forkNext = false;
      const proc = await ctx.spawnWorker(
        buildArgs(withSkill(att.prompt, skill), resumeSessionId, agentPersona, spec.model, [...(await permissionArgs(ctx)), ...att.dirs.flatMap((d) => ["--add-dir", d])], permissionMode, true, forkNext),
        workerEnv(spec.env),
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
          const att = withAttachments(input.text, input.attachments);
          const fork = meta?.forkNext === true;
          if (meta) meta.forkNext = false;
          const proc = await ctx.spawnWorker(
            buildArgs(withSkill(att.prompt, meta?.skill), meta?.resumeSessionId, undefined, meta?.model, [...(await permissionArgs(ctx)), ...att.dirs.flatMap((d) => ["--add-dir", d])], meta?.permissionMode, true, fork),
            workerEnv(undefined),
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
        case "configure": {
          // ADR-0033: claude -p starts a process per turn — the change applies from the next one.
          if (!meta) return { ok: false, detail: "claude: Session unbekannt" };
          if (input.permissionMode !== undefined) {
            if (!(PERMISSION_MODES as readonly string[]).includes(input.permissionMode)) return { ok: false, detail: `claude: Modus „${input.permissionMode}“ unbekannt` };
            meta.permissionMode = input.permissionMode;
          }
          if (input.model !== undefined) meta.model = input.model;
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

    /** ADR-0014: after a hub restart, take over the turn that is still
     * running, or continue natively with the next prompt. */
    async recover(sessionId: string, _lastSeq: number, ctx: AdapterContext): Promise<SessionHandle | null> {
      const native = ctx.nativeSessionId ?? undefined;
      const proc = (await ctx.adoptWorker?.()) ?? null;
      if (!proc && !native) return null;
      const meta: SessionMeta = { healthy: true, degraded: false, ...(native ? { resumeSessionId: native } : {}) };
      if (proc) attach(sessionId, proc, ctx, meta);
      else sessions.set(sessionId, meta);
      return { sessionId, ...(proc?.pid !== undefined ? { pid: proc.pid } : {}) };
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

/** How much of the transcript becomes the hub's history — the tail, not
 * the whole file: the phone needs "where do I stand", not every tool
 * output of three weeks ago. */
const TRANSCRIPT_IMPORT_LIMIT = 200;

/**
 * The continued conversation's transcript, mapped into the hub's tail
 * (Nutzerwunsch 2026-09-28: never ask the agent for its history first).
 * A missing/unreadable transcript never blocks the continuation — it
 * shows a visible note instead.
 */
async function importTranscript(ctx: AdapterContext, project: string, resumeSessionId: string, claudeDir?: string): Promise<void> {
  const dir = claudeDir ?? join(homedir(), ".claude");
  // Claude Code munges the cwd the same way the discovery learned the
  // hard way (BUG-0035): every non-alphanumeric character becomes `-`.
  // The transcript lives where the run happened — the project, not the
  // hub's worktree copy; the workdir is the fallback.
  const candidates = [project, ctx.workdir].map((p) => join(dir, "projects", p.replace(/[^a-zA-Z0-9]/g, "-"), `${resumeSessionId}.jsonl`));
  const file = candidates.find((p) => existsSync(p));
  if (!file) {
    ctx.emit({ type: "system", summary: `claude: kein Transkript zu ${resumeSessionId.slice(0, 8)} gefunden — Verlauf bleibt beim Anbieter`, payload: { kind: "claude.transcript_missing", tried: candidates } });
    return;
  }
  try {
    const lines = (await readFile(file, "utf8")).split("\n").filter((l) => l.trim().length > 0);
    const events = lines.flatMap((line) => {
      try {
        return normalizeClaudeLine(JSON.parse(line) as Record<string, unknown>);
      } catch {
        return [];
      }
    });
    // ADR-0040: attachment notes carry no conversation — they must not use up the window.
    const shown = events.filter((e) => e.payload?.subtype !== "attachment");
    const cut = shown.length > TRANSCRIPT_IMPORT_LIMIT ? shown.slice(-TRANSCRIPT_IMPORT_LIMIT) : shown;
    ctx.emit({
      type: "system",
      summary: `claude: Verlauf aus Transkript übernommen (${cut.length} von ${shown.length} Events, ${resumeSessionId.slice(0, 8)})`,
      payload: { kind: "claude.transcript_imported", session: resumeSessionId, imported: cut.length, total: shown.length },
    });
    for (const e of cut) ctx.emit(e);
  } catch (err) {
    ctx.emit({ type: "system", summary: "claude: Transkript nicht lesbar — Verlauf bleibt beim Anbieter", payload: { kind: "claude.transcript_unreadable", error: err instanceof Error ? err.message : String(err) } });
  }
}
