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
} from "@ancientvoid/contracts";
import { promptWithAttachments } from "@ancientvoid/contracts";
import { createLivePump, type StreamKind } from "@ancientvoid/contracts"; // ADR-0083
import { modelsFromCommand } from "@ancientvoid/models";
import { claudeStreamDelta, normalizeClaudeLine } from "./normalize.ts";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * claude adapter (P1 reference/"golden path"). Spawns the real CLI via
 * ctx.spawnWorker (never child_process directly — AdapterContext rule) and
 * maps its stream-json output through normalize.ts. One persistent
 * streaming-input process per session (ADR-0098): prompts travel as NDJSON
 * on stdin, so a running turn can be steered without a second process.
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
  /** ADR-0054 (EPIC-P35 T35.7): listendes Kommando für den Modell-Katalog —
   * schlägt die dokumentierten Aliase; ohne Config bleiben die Aliase. */
  modelsCommand: z.array(z.string().min(1)).min(1).optional(),
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

type ClaudeControl = { subtype: "set_model"; model: string | null } | { subtype: "set_permission_mode"; mode: string };

interface LiveClaude {
  proc: WorkerProcess;
  control(request: ClaudeControl): Promise<Ack>;
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
  const procs = new Map<string, LiveClaude>();
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
    resumeSessionId?: string,
    agent?: string,
    model?: string,
    extra: string[] = [],
    mode?: string,
    modelOnResume = false,
    fork = false,
    partial = false,
  ): string[] {
    // ADR-0098: streaming input — the prompt travels as NDJSON on stdin,
    // never in argv. That is what makes steering into a running turn
    // possible at all (BUG-0235); -p stays, it only selects print mode.
    const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", ...extra];
    // ADR-0083: der Hub kann Frames empfangen — dann verlangt claude die expliziten
    // Teil-Nachrichten, sonst kommen die Deltas nie an (nur die fertigen Blöcke).
    if (partial) args.push("--include-partial-messages");
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

  /** ADR-0098: one user message on the streaming-input channel (NDJSON). */
  function stdinLine(text: string): string {
    return `${JSON.stringify({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null })}\n`;
  }

  /** ADR-0098/ADR-0013-Nachtrag: der Prompt geht auf den stdin-Kanal und
   * meldet den Zugbeginn — Zugende meldet das result-Event des Streams. */
  function sendPrompt(proc: WorkerProcess, text: string, ctx: AdapterContext): void {
    proc.write(stdinLine(text));
    ctx.turn?.("working");
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
    const pending = new Map<string, (ack: Ack) => void>();
    const worker: LiveClaude = {
      proc,
      control: (request) => new Promise<Ack>((resolve) => {
        const id = crypto.randomUUID();
        const done = (ack: Ack) => {
          clearTimeout(timer);
          pending.delete(id);
          resolve(ack);
        };
        const timer = setTimeout(() => done({ ok: false, detail: "Claude hat die Einstellung nicht bestätigt." }), 5_000).unref();
        pending.set(id, done);
        try {
          proc.write(`${JSON.stringify({ type: "control_request", request_id: id, request })}\n`);
        } catch (err) {
          done({ ok: false, detail: String(err).slice(0, 300) });
        }
      }),
    };
    procs.set(sessionId, worker);
    sessions.set(sessionId, meta);
    // ADR-0083: claude sendet echte Deltas in `stream_event`-Hüllen. Mit Stream-Kanal
    // gehen sie gebündelt als Frames raus; ohne Kanal bleibt die alte Hüllen-Meldung —
    // nichts geht verloren, der fertige Block kommt in beiden Fällen.
    const live = ctx.stream ? createLivePump((f) => ctx.stream?.(f)) : undefined;
    const blockStream = new Map<number, StreamKind>();

    let buffer = "";
    let mainModel: string | undefined;
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
        if (!parsed || typeof parsed !== "object") {
          for (const event of normalizeClaudeLine(parsed)) ctx.emit(event);
          continue;
        }
        if ("type" in parsed && parsed.type === "control_response") {
          const reply = (parsed as { response?: { request_id?: unknown; subtype?: unknown; error?: unknown; response?: { model?: unknown } } }).response;
          const receive = typeof reply?.request_id === "string" ? pending.get(reply.request_id) : undefined;
          if (receive && reply?.subtype === "success") {
            if (typeof reply.response?.model === "string") mainModel = reply.response.model;
            receive({ ok: true });
          } else if (receive) {
            receive({ ok: false, detail: typeof reply?.error === "string" ? reply.error.slice(0, 300) : "Claude hat die Einstellung abgelehnt." });
          }
          continue;
        }
        const task = parsed as { type?: string; subtype?: string; model?: unknown; task_id?: unknown; description?: unknown; status?: unknown; queued_turn_count?: unknown };
        if (task.type === "system" && task.subtype === "init" && typeof task.model === "string") mainModel = task.model;
        if (task.type === "system" && typeof task.task_id === "string") {
          if (task.subtype === "task_started") ctx.activity?.({ id: `task:${task.task_id}`, kind: "agent", state: "running", ...(typeof task.description === "string" ? { label: task.description.slice(0, 160) } : {}) });
          if (task.subtype === "task_notification") ctx.activity?.({ id: `task:${task.task_id}`, kind: "agent", state: task.status === "completed" ? "completed" : "failed" });
        }
        const part = live ? claudeStreamDelta(parsed as Record<string, unknown>) : null;
        if (part) {
          const kind = blockStream.get(part.index) ?? part.stream;
          if (part.inner === "start") blockStream.set(part.index, part.stream);
          else if (part.inner === "delta") live!.delta(kind, part.text);
          else {
            live!.end(kind);
            blockStream.delete(part.index);
          }
        } else {
          for (const event of normalizeClaudeLine(parsed, mainModel)) ctx.emit(event);
        }
        if (task.type === "result" && proc.stdinMode !== "tty" &&
          !(typeof task.queued_turn_count === "number" && task.queued_turn_count > 0)) ctx.turn?.("idle");
      }
    });

    proc.onStderr((chunk) => {
      ctx.log("warn", "claude stderr", { chunk: chunk.slice(0, 500) });
    });

    proc.onExit((code) => {
      live?.close(); // ADR-0083: offene Frame-Timer weg, ein unvollendeter Block hat keine Frames mehr
      for (const done of pending.values()) done({ ok: false, detail: "Claude wurde vor der Bestätigung beendet." });
      if (code === 0 && proc.stdinMode === "tty") ctx.turn?.("idle");
      // Drop the dead process reference (procs), but keep `meta` — it
      // carries resumeSessionId, which the *next* steer(prompt) needs.
      // ADR-0098: der Streaming-Prozess lebt über Zugenden hinweg — ein
      // sauberer Exit (code 0) ist das Ende des Prozesses, nicht der
      // Session: sie ist zwischen Prozessen idle, NOT down (BUG-0008).
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
      if (procs.get(sessionId) === worker) procs.delete(sessionId);
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
        promptDelivery: "next-turn",
        // ADR-0098 (BUG-0235): der Streaming-Input-Prozess nimmt Meldungen
        // mitten im laufenden Zug an (stdin, injiziert nach dem laufenden
        // Tool-Call) — kein Zweitprozess nötig, ADR-0074 bleibt heil.
        midTurnInput: true,
        // ADR-0098: promptloser Start spawnt nichts — die Session öffnet idle,
        // statt ewig "working" zu hängen (e2e-Fund 2026-11-20).
        promptlessStartIdle: true,
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
        // EPIC-P35 T35.3: `hub: true` — die promptlose Übernahme (start ohne
        // Prompt bleibt idle, ADR-0040) macht „Weitermachen“ hub-fähig.
        resume: { argv: ["claude", "--resume", "{sessionId}"], ref: "native", hub: true, auto: true },
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
     * resolves to the latest model of that line. ADR-0054: `modelsCommand`
     * aus der Konfiguration schlägt die Aliase. */
    async models(): Promise<ModelOption[]> {
      if (cfg.modelsCommand) return modelsFromCommand(cfg.modelsCommand);
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
      if (!spec.prompt?.trim() && !spec.attachments?.length) {
        // ADR-0040/ADR-0098: kein Prompt, kein Zug — und kein Prozess: ein
        // Streaming-Prozess ohne erste stdin-Nachricht würde nur auf Eingabe
        // warten und die Session auf `working` halten (e2e-Fund 2026-11-20).
        // Idle zwischen Zügen; der nächste steer spawnt (mit --resume und
        // Fork, falls übernommen; `claude -p "" --resume` starb zudem am
        // "No deferred tool marker", live 2026-10-27).
        sessions.set(ctx.sessionId, meta);
        return { sessionId: ctx.sessionId };
      }
      meta.forkNext = false;
      // ADR-0098: ein persistenter Streaming-Prozess; der Prompt geht als
      // NDJSON-Zeile auf den stdin-Kanal, nicht ins Argv.
      const proc = await ctx.spawnWorker(
        buildArgs(resumeSessionId, agentPersona, spec.model, [...(await permissionArgs(ctx)), ...att.dirs.flatMap((d) => ["--add-dir", d])], permissionMode, true, forkNext, Boolean(ctx.stream)),
        { stdin: "pipe", persistent: true, ...workerEnv(spec.env) },
      );
      attach(ctx.sessionId, proc, ctx, meta);
      sendPrompt(proc, withSkill(att.prompt, skill), ctx);
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
          // ADR-0098: ein lebender Streaming-Prozess nimmt die Meldung auf
          // dem stdin-Kanal an — mitten im Zug (injiziert nach dem laufenden
          // Tool-Call) wie zwischen Zügen. Nie ein Zweitprozess auf dieselbe
          // native Session (ADR-0074); erst nach Exit spawnt der nächste
          // Prompt einen frischen --resume-Prozess. Der Skill (falls einer)
          // wird wie bisher auf jeden Prompt reappliziert; --agent bewusst
          // nicht (siehe buildArgs' Doc-Kommentar).
          const att = withAttachments(input.text, input.attachments);
          const live = procs.get(handle.sessionId);
          if (live) {
            if (live.proc.stdinMode === "tty") return { ok: false, detail: "Der übernommene Claude-Prozess hat erst nach seinem Zugende einen Streaming-Eingabekanal." };
            if (att.dirs.length > 0) {
              // --add-dir gilt je Prozess und ist im laufenden nicht
              // nachrüstbar — der Pfad steht im Prompt, ein nötiger Zugriff
              // geht über die Freigabe-Brücke (ADR-0018 §3). Fail loud.
              ctx.emit({
                type: "system",
                summary: "claude: Anhang-Verzeichnis im laufenden Zug nicht mehr freigebbar (--add-dir gilt je Prozess) — Zugriff läuft über die Freigabe-Brücke",
                payload: { kind: "claude.add_dir_live_skipped", count: att.dirs.length },
              });
            }
            sendPrompt(live.proc, withSkill(att.prompt, meta?.skill), ctx);
            return { ok: true };
          }
          const fork = meta?.forkNext === true;
          if (meta) meta.forkNext = false;
          const proc = await ctx.spawnWorker(
            buildArgs(meta?.resumeSessionId, undefined, meta?.model, [...(await permissionArgs(ctx)), ...att.dirs.flatMap((d) => ["--add-dir", d])], meta?.permissionMode, true, fork, Boolean(ctx.stream)),
            { stdin: "pipe", persistent: true, ...workerEnv(undefined) },
          );
          attach(handle.sessionId, proc, ctx, meta ?? { healthy: true, degraded: false });
          sendPrompt(proc, withSkill(att.prompt, meta?.skill), ctx);
          return { ok: true };
        }
        case "stop":
          await adapter.stop(handle, ctx);
          return { ok: true };
        case "park": {
          await procs.get(handle.sessionId)?.proc.kill("SIGTERM");
          return { ok: true };
        }
        case "configure": {
          if (!meta) return { ok: false, detail: "claude: Session unbekannt" };
          if (input.permissionMode !== undefined && !(PERMISSION_MODES as readonly string[]).includes(input.permissionMode)) {
            return { ok: false, detail: `claude: Modus „${input.permissionMode}“ unbekannt` };
          }
          const live = procs.get(handle.sessionId);
          if (live && live.proc.stdinMode !== "tty") {
            if (input.model !== undefined) {
              const ack = await live.control({ subtype: "set_model", model: input.model });
              if (!ack.ok) return ack;
            }
            if (input.permissionMode !== undefined) {
              const ack = await live.control({ subtype: "set_permission_mode", mode: input.permissionMode });
              if (!ack.ok) {
                if (input.model === undefined) return ack;
                const reverted = await live.control({ subtype: "set_model", model: meta.model ?? null });
                return reverted.ok ? ack : { ok: false, detail: "Claude hat den Moduswechsel und das Zurücksetzen des Modells nicht bestätigt." };
              }
            }
          }
          if (input.permissionMode !== undefined) meta.permissionMode = input.permissionMode;
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
      const proc = (await ctx.adoptWorker?.({ persistent: true })) ?? null;
      if (!proc && !native) return null;
      const meta: SessionMeta = { healthy: true, degraded: false, ...(native ? { resumeSessionId: native } : {}) };
      if (proc) attach(sessionId, proc, ctx, meta);
      else sessions.set(sessionId, meta);
      return { sessionId, ...(proc?.pid !== undefined ? { pid: proc.pid } : {}) };
    },

    async stop(handle: SessionHandle): Promise<void> {
      await procs.get(handle.sessionId)?.proc.kill("SIGTERM");
      procs.delete(handle.sessionId);
      sessions.delete(handle.sessionId);
    },

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
