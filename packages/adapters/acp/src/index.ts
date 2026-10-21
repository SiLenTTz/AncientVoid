import { z } from "zod";
import {
  basicFeatures,
  promptWithAttachments,
  providerErrorEvent,
  type Ack,
  type Adapter,
  type AdapterCapabilities,
  type AdapterContext,
  type HealthReport,
  type ModelOption,
  type PromptAttachment,
  type SessionHandle,
  type SessionSpec,
  type SteerInput,
  type WorkerProcess,
} from "@uacc/contracts";
import { JsonRpcConnection as AcpConnection, RpcError } from "@uacc/adapter-jsonrpc";
import { resolveContextWindow } from "@uacc/models";
import { UpdateMapper, type SessionUpdate } from "./normalize.ts";
import { probeModelCatalog } from "./catalog.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * ACP adapter (T7.2, ADR-0018 §3): one Agent Client Protocol harness per
 * session, as a persistent worker (tmux pipe mode, ADR-0013 Nachtrag).
 * Tool permissions come back as `session/request_permission` and are
 * decided on the phone (`ctx.requestToolPermission`).
 *
 * Config (hub.config.json → adapters[].config):
 *   preset:  "copilot" | "opencode" | "dsh" — known command lines (below),
 *   command: the agent command line (overrides the preset),
 *   env:     extra environment for the agent,
 *   label:   name in summaries and errors (default: preset or "acp"),
 *   permissions: "hub" (default) — ask the phone; "reject" — deny all,
 *   model:   model when the session names none (see `pickModel`),
 *   stuckTurnMs: BUG-0032 — a busy turn with no agent message for this
 *             long is cancelled (`session/cancel`) and, if that stays
 *             unanswered too, force-ended. 0 disables. A pending
 *             permission request disarms it (waiting for the phone is
 *             not being stuck). Default 30 min.
 */

/** ACP ToolKind → the tool name shown on the approval card. */
const KIND_LABEL: Record<string, string> = {
  execute: "Shell",
  edit: "Bearbeiten",
  read: "Lesen",
  delete: "Löschen",
  move: "Verschieben",
  search: "Suchen",
  fetch: "Web-Abruf",
  think: "Denken",
  switch_mode: "Modus wechseln",
};

/** Known ACP harnesses. The opencode preset makes it ask for edits and
 * shell commands — by default it would run them unasked (ADR-0018). dsh
 * runs its tools in an OS sandbox; in `read-only` every write or command
 * that needs more asks for escalation — on the phone (T7.5, live verified). */
export const ACP_PRESETS = {
  // copilot 1.0.88 offers no model option over ACP (checked live 2026-09-24).
  copilot: { command: ["copilot", "--acp"], env: {}, models: false },
  opencode: {
    command: ["opencode", "acp"],
    env: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: { edit: "ask", bash: "ask", webfetch: "ask" } }) },
  },
  // dsh 0.2.1 answers initialize with promptCapabilities.image=false: images reach it as
  // the OCR text of the attachment (live checked 2026-10-21), not as image blocks.
  dsh: { command: ["dsh", "--profile", "acp"], env: { DSH_PERMISSION_MODE: "read-only" }, images: false },
} as const satisfies Record<string, { command: string[]; env: Record<string, string>; models?: boolean; images?: boolean }>;

const AcpConfig = z.object({
  preset: z.enum(["copilot", "opencode", "dsh"]).optional(),
  command: z.array(z.string().min(1)).min(1).optional(),
  env: z.record(z.string(), z.string()).default({}),
  label: z.string().min(1).optional(),
  permissions: z.enum(["hub", "reject"]).default("hub"),
  model: z.string().min(1).optional(),
  /** How long initialize/session setup may take (npx may download first). */
  startupTimeoutMs: z.number().int().positive().default(120_000),
  /** BUG-0032: silence window within a busy turn before the hub cancels. */
  stuckTurnMs: z.number().int().min(0).default(1_800_000),
  /** ADR-0032: context window of the models this instance runs — nobody
   * reports it in band; configured here, shown as a percentage then. */
  contextWindowTokens: z.number().int().positive().optional(),
  /** ADR-0032: per-model context windows — substring-matched over the
   * wanted model and the agent's raw value; wins over the built-in table
   * (@uacc/models, Quelle models.dev). */
  contextWindows: z.record(z.string().min(1), z.number().int().positive()).default({}),
  /** Model catalog for the start form: a command printing one
   * `provider/model` per line. Derived for opencode (`opencode models`). */
  modelsCommand: z.array(z.string().min(1)).min(1).optional(),
});

const PROTOCOL_VERSION = 1;
/** How long a wanted model may take to appear in the agent's list. */
const MODEL_WAIT_MS = 5_000;
/** BUG-0033: buffered chunks go to the tail live while the turn runs —
 * the phone sees the agent working instead of silence until turn end. */
const LIVE_FLUSH_MS = 1_500;

/** What `session/new` says about models: the config option (ACP) or the
 * older `models` block (unstable API, still used by some agents). */
export interface SessionModels {
  configOptions?: { id: string; category?: string | null; currentValue?: unknown; options?: ({ value: string; name?: string } | { group?: string; options?: { value: string; name?: string }[] })[] }[];
  models?: { currentModelId?: string; availableModels?: { modelId: string; name?: string }[] } | null;
}

/**
 * ADR-0018 modelChoice "start": the wanted model → how to set it. Matches
 * the offered value, its name, or `provider/model` against a value that is
 * a JSON pair (dsh: `["evox2","qwen3-coder"]`). Nothing matches → null, and
 * the caller says so visibly instead of running on another model.
 */
export function pickModel(res: SessionModels, wanted: string): { method: string; params: Record<string, unknown>; value: string } | null {
  const same = (value: string, name?: string) => {
    if (value === wanted || name === wanted) return true;
    try {
      const pair = JSON.parse(value) as unknown;
      return Array.isArray(pair) && pair.length === 2 && `${pair[0]}/${pair[1]}` === wanted;
    } catch {
      return false;
    }
  };
  const option = res.configOptions?.find((o) => o.category === "model" || o.id === "model");
  if (option) {
    const flat = (option.options ?? []).flatMap((o) => ("value" in o ? [o] : (o.options ?? [])));
    const hit = flat.find((o) => same(o.value, o.name));
    if (hit) return { method: "session/set_config_option", params: { configId: option.id, value: hit.value }, value: hit.value };
  }
  const model = res.models?.availableModels?.find((m) => same(m.modelId, m.name));
  if (model) return { method: "session/set_model", params: { modelId: model.modelId }, value: model.modelId };
  return null;
}

/** T7.10: prompt blocks — images as image content if the agent takes them. */
async function promptBlocks(text: string, attachments: readonly PromptAttachment[] | undefined, images: boolean): Promise<Record<string, unknown>[]> {
  const native = images ? (attachments ?? []).filter((a) => a.kind === "image" && a.bytes <= 10 * 1024 * 1024) : [];
  const { readFile } = await import("node:fs/promises");
  const blocks: Record<string, unknown>[] = [{ type: "text", text: promptWithAttachments(text, attachments, new Set(native.map((a) => a.id))) }];
  for (const a of native) blocks.push({ type: "image", mimeType: a.mimeType, data: (await readFile(a.path)).toString("base64") });
  return blocks;
}

interface AgentSession {
  proc: WorkerProcess;
  conn: AcpConnection;
  acpSessionId: string | null;
  busy: boolean;
  mapper: UpdateMapper;
  healthy: boolean;
  /** From initialize: the agent takes image content blocks. */
  images: boolean;
  /** Tool calls seen in updates — some agents (dsh) ask with the id only. */
  calls: Map<string, ToolCallInfo>;
  /** Latest `config_option_update` — can be newer than the session/new answer. */
  configOptions: SessionModels["configOptions"];
  onConfig: (() => void) | null;
  /** BUG-0032: every runTurn bump; a stale turn's late answers are ignored. */
  turnSeq: number;
  /** BUG-0036: session/load re-notifies the whole history — map+emit stay
   * off until the load answered; the hub's tail already has it all. */
  replay: boolean;
  stuckTimer: ReturnType<typeof setTimeout> | null;
  /** Open permission requests — the agent waits for the phone, not stuck. */
  pendingPermissions: number;
  /** Prompts sent while a turn runs — delivered when it ends (FIFO). */
  queued: { text: string; attachments?: readonly PromptAttachment[] }[];
}

type ToolCallInfo = { toolCallId?: string; title?: string | null; name?: string | null; kind?: string | null; rawInput?: unknown };

export function createAdapter(config?: Readonly<Record<string, unknown>>): Adapter {
  const cfg = AcpConfig.parse(config ?? {});
  const preset = cfg.preset ? ACP_PRESETS[cfg.preset] : undefined;
  const command = cfg.command ?? (preset ? [...preset.command] : undefined);
  if (!command) throw new Error("acp adapter: config needs `preset` or `command`");
  const env = { ...(preset?.env ?? {}), ...cfg.env };
  const label = cfg.label ?? cfg.preset ?? "acp";
  const sessions = new Map<string, AgentSession>();

  function emitAll(ctx: AdapterContext, events: ReturnType<UpdateMapper["flush"]>): void {
    for (const e of events) ctx.emit(e);
  }

  /** BUG-0032: re-arm the stuck watchdog — every agent message is activity. */
  function armStuckWatch(state: AgentSession, ctx: AdapterContext): void {
    if (state.stuckTimer) clearTimeout(state.stuckTimer);
    state.stuckTimer = null;
    if (cfg.stuckTurnMs <= 0) return;
    state.stuckTimer = setTimeout(() => unstickTurn(state, ctx), cfg.stuckTurnMs);
  }

  /** BUG-0032: a busy turn gone silent is cancelled loudly; an agent that
   * ignores the cancel is force-ended so the session recovers (was: busy
   * forever, every further prompt refused — 26 h live, 2026-09-25). */
  function unstickTurn(state: AgentSession, ctx: AdapterContext): void {
    state.stuckTimer = null;
    if (!state.busy || !state.healthy) return;
    if (state.pendingPermissions > 0) return armStuckWatch(state, ctx);
    const minutes = Math.max(1, Math.round(cfg.stuckTurnMs / 60_000));
    ctx.emit(providerErrorEvent(label, `${label}: der Zug ist seit ${minutes} min stumm — der Hub bricht ab (session/cancel)`));
    if (state.acpSessionId) state.conn.notify("session/cancel", { sessionId: state.acpSessionId });
    const seq = state.turnSeq;
    setTimeout(() => {
      if (!state.busy || state.turnSeq !== seq) return; // the cancel was honored — normal turn end took over
      state.turnSeq++; // the dangling prompt's late answer is not ours any more
      emitAll(ctx, state.mapper.flush());
      ctx.emit({ type: "system", summary: `${label}: Agent reagierte nicht auf session/cancel — Zug erzwungen beendet`, payload: { kind: "acp.turn_stuck" } });
      state.busy = false;
      ctx.turn?.("idle");
      drainQueue(state, ctx);
    }, Math.min(10_000, cfg.stuckTurnMs));
  }

  /** ACP permission request → the phone → the option the agent offered. */
  async function decidePermission(state: AgentSession, ctx: AdapterContext, params: unknown): Promise<unknown> {
    const p = params as { toolCall?: ToolCallInfo; options?: { optionId: string; kind: string }[] };
    const options = p.options ?? [];
    const pick = (kinds: string[]) => kinds.map((k) => options.find((o) => o.kind === k)).find(Boolean);
    const deny = () => {
      const reject = pick(["reject_once", "reject_always"]);
      return reject ? { outcome: { outcome: "selected", optionId: reject.optionId } } : { outcome: { outcome: "cancelled" } };
    };
    if (cfg.permissions !== "hub" || !ctx.requestToolPermission) return deny();
    const seen = p.toolCall?.toolCallId ? state.calls.get(p.toolCall.toolCallId) : undefined;
    const call: ToolCallInfo = { ...seen, ...Object.fromEntries(Object.entries(p.toolCall ?? {}).filter(([, v]) => v !== undefined && v !== null)) };
    const input = call.rawInput && typeof call.rawInput === "object" && !Array.isArray(call.rawInput) ? (call.rawInput as Record<string, unknown>) : { title: call.title ?? call.kind ?? "tool" };
    const answer = await ctx.requestToolPermission({
      toolName: (call.name ?? (call.kind ? KIND_LABEL[call.kind] : undefined) ?? call.title ?? call.kind ?? "tool").slice(0, 200),
      input,
      ...(call.toolCallId ? { toolUseId: call.toolCallId.slice(0, 200) } : {}),
    });
    if (answer.behavior !== "allow") return deny();
    // Never "always": every call is its own decision (ADR-0018).
    const allow = pick(["allow_once"]) ?? pick(["allow_always"]);
    return allow ? { outcome: { outcome: "selected", optionId: allow.optionId } } : deny();
  }

  function connect(sessionId: string, proc: WorkerProcess, ctx: AdapterContext): AgentSession {
    const state: AgentSession = { proc, conn: null as unknown as AcpConnection, acpSessionId: null, busy: false, mapper: new UpdateMapper(label), healthy: true, images: false, calls: new Map(), configOptions: undefined, onConfig: null, turnSeq: 0, replay: false, stuckTimer: null, pendingPermissions: 0, queued: [] };
    state.conn = new AcpConnection((line) => proc.write(line), {
      onNotification: (method, params) => {
        if (method !== "session/update") return;
        armStuckWatch(state, ctx); // BUG-0032: an update is activity
        const update = (params as { update?: SessionUpdate }).update;
        if (!update) return;
        if (update.sessionUpdate === "config_option_update") {
          state.configOptions = (update as { configOptions?: SessionModels["configOptions"] }).configOptions;
          state.onConfig?.();
          return;
        }
        if ((update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") && typeof update.toolCallId === "string") {
          const known = state.calls.get(update.toolCallId) ?? {};
          const u = update as ToolCallInfo;
          state.calls.set(update.toolCallId, { ...known, ...(u.title ? { title: u.title } : {}), ...(u.kind ? { kind: u.kind } : {}), ...(u.rawInput !== undefined ? { rawInput: u.rawInput } : {}) });
          if (state.calls.size > 200) state.calls.delete(state.calls.keys().next().value!);
        }
        // BUG-0036: a re-loaded session arrives as update notifications —
        // they are history, not news; nothing to emit while replaying.
        if (!state.replay) emitAll(ctx, state.mapper.map(update));
      },
      onRequest: async (method, params) => {
        if (method === "session/request_permission") {
          armStuckWatch(state, ctx); // BUG-0032: asking is activity, and the answer may take hours
          state.pendingPermissions++;
          try {
            return await decidePermission(state, ctx, params);
          } finally {
            state.pendingPermissions--;
          }
        }
        throw new RpcError(-32601, `${method} wird vom Hub nicht angeboten`);
      },
      // A prompt sent by the hub before a restart ends here — the turn is over.
      onStrayResult: (result) => {
        if (result && typeof result === "object" && "stopReason" in result) {
          emitAll(ctx, state.mapper.flush());
          state.busy = false;
          ctx.turn?.("idle");
          drainQueue(state, ctx);
        }
      },
      onNoise: (line) => ctx.log("debug", `${label}: non-JSON output`, { line: line.slice(0, 300) }),
    });
    proc.onStdout((chunk) => state.conn.feed(chunk));
    proc.onExit((code) => {
      state.healthy = false;
      if (state.stuckTimer) clearTimeout(state.stuckTimer);
      state.conn.failAll(`${label}-Prozess beendet (Code ${code ?? "?"})`);
      emitAll(ctx, state.mapper.flush());
      if (code !== 0 && code !== null) ctx.emit({ type: "system", summary: `${label}: process exited with code ${code}`, payload: { code } });
      if (state.busy) {
        state.busy = false;
        ctx.turn?.("idle");
      }
      if (state.queued.length) {
        ctx.emit({ type: "system", summary: `${label}: ${state.queued.length} wartende Nachricht(en) verworfen — Agent-Prozess beendet`, payload: { kind: "acp.queued_dropped", count: state.queued.length } });
        state.queued = [];
      }
      if (sessions.get(sessionId) === state) sessions.delete(sessionId);
    });
    sessions.set(sessionId, state);
    return state;
  }

  async function initialize(state: AgentSession): Promise<{ loadSession: boolean; resume: boolean }> {
    const init = (await state.conn.request(
      "initialize",
      { protocolVersion: PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: "uacc-hub", version: "0.1.0" } },
      cfg.startupTimeoutMs,
    )) as { agentCapabilities?: { loadSession?: boolean; sessionCapabilities?: { resume?: unknown }; promptCapabilities?: { image?: boolean } } };
    state.images = init.agentCapabilities?.promptCapabilities?.image === true;
    return { loadSession: init.agentCapabilities?.loadSession === true, resume: Boolean(init.agentCapabilities?.sessionCapabilities?.resume) };
  }

  function announce(ctx: AdapterContext, acpSessionId: string): void {
    ctx.emit({ type: "system", summary: `${label} · Session ${acpSessionId}`, payload: { kind: "acp.native_session", nativeSessionId: acpSessionId } });
  }

  /** BUG-0036: load/resume a native session with the replay silenced —
   * the agent re-notifies the loaded conversation; the hub's tail already
   * has it. Returns false when the agent cannot load at all.
   * BUG-0039: `emit` flips it for adoptions — an observed session's
   * history exists only in this replay, so it must reach the stream. */
  async function resumeNative(state: AgentSession, ctx: AdapterContext, native: string, canLoad: boolean, emit = false): Promise<boolean> {
    if (!canLoad) return false;
    if (!emit) state.replay = true;
    try {
      await state.conn.request("session/load", { sessionId: native, cwd: ctx.workdir, mcpServers: [] }, cfg.startupTimeoutMs);
    } finally {
      state.replay = false;
      const buffered = state.mapper.flush();
      if (emit) emitAll(ctx, buffered);
    }
    state.acpSessionId = native;
    announce(ctx, native);
    return true;
  }

  async function newSession(state: AgentSession, ctx: AdapterContext, model?: string): Promise<void> {
    const res = (await state.conn.request("session/new", { cwd: ctx.workdir, mcpServers: [] }, cfg.startupTimeoutMs)) as { sessionId: string } & SessionModels;
    state.acpSessionId = res.sessionId;
    announce(ctx, res.sessionId);
    if (!model) return;
    // dsh registers routes from its settings right after boot: the answer
    // may predate them, a config_option_update follows (seen live).
    const find = () => (state.configOptions ? pickModel({ configOptions: state.configOptions }, model) : null) ?? pickModel(res, model);
    let set = find();
    for (const until = Date.now() + MODEL_WAIT_MS; !set && Date.now() < until; set = find()) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 250);
        state.onConfig = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      state.onConfig = null;
    }
    if (!set) throw new Error(`${label}: Modell „${model}" wird nicht angeboten`);
    await state.conn.request(set.method, { sessionId: res.sessionId, ...set.params }, cfg.startupTimeoutMs);
    // ADR-0032: the window of THIS model — config table first, then the
    // curated one; rides the event so the PWA needs no adapter roundtrip.
    const window = resolveContextWindow(model, set.value, cfg.contextWindows);
    ctx.emit({
      type: "system",
      summary: `${label} · ${model}`,
      payload: { kind: "acp.model", model, value: set.value, ...(window !== null ? { contextWindowTokens: window } : {}) },
    });
  }

  function drainQueue(state: AgentSession, ctx: AdapterContext): void {
    if (state.busy || !state.healthy) return;
    const next = state.queued.shift();
    if (!next) return;
    ctx.emit({ type: "system", summary: `${label}: wartende Nachricht wird jetzt zugestellt`, payload: { kind: "acp.queued_delivered", remaining: state.queued.length } });
    runTurn(state, ctx, next.text, next.attachments);
  }

  function runTurn(state: AgentSession, ctx: AdapterContext, text: string, attachments?: readonly PromptAttachment[]): void {
    state.busy = true;
    const seq = ++state.turnSeq; // BUG-0032: a forced end invalidates this turn's late answers
    ctx.turn?.("working");
    armStuckWatch(state, ctx);
    // BUG-0033: interim flush of buffered message/thought text — a no-op
    // tick when nothing is pending, the tail's live feed otherwise.
    const liveFlush = setInterval(() => {
      if (state.turnSeq === seq && state.busy) emitAll(ctx, state.mapper.flush());
    }, LIVE_FLUSH_MS);
    void promptBlocks(text, attachments, state.images)
      .then((prompt) => state.conn.request("session/prompt", { sessionId: state.acpSessionId, prompt }))
      .then((res) => {
        if (state.turnSeq !== seq) return;
        const r = res as { stopReason?: string; usage?: { totalTokens?: number; inputTokens?: number; outputTokens?: number } | null };
        emitAll(ctx, state.mapper.flush());
        // ADR-0032: input is the context fill; tokens fall back to
        // input+output when the agent names no total.
        const inTok = typeof r.usage?.inputTokens === "number" ? r.usage.inputTokens : undefined;
        const outTok = typeof r.usage?.outputTokens === "number" ? r.usage.outputTokens : undefined;
        const total = typeof r.usage?.totalTokens === "number" ? r.usage.totalTokens : inTok !== undefined && outTok !== undefined ? inTok + outTok : undefined;
        ctx.emit({
          type: "system",
          summary: `${label}: Zug beendet (${r.stopReason ?? "?"})`,
          payload: {
            kind: "acp.turn_end",
            stopReason: r.stopReason ?? null,
            ...(inTok !== undefined || outTok !== undefined ? { usage: { ...(inTok !== undefined ? { input: inTok } : {}), ...(outTok !== undefined ? { output: outTok } : {}) } } : {}),
          },
          ...(total !== undefined ? { tokensEst: total } : {}),
        });
        if (r.stopReason === "refusal") ctx.emit(providerErrorEvent(label, "Der Agent hat die Anfrage abgelehnt (refusal)."));
      })
      .catch((err: unknown) => {
        if (state.turnSeq !== seq) return;
        emitAll(ctx, state.mapper.flush());
        ctx.emit(providerErrorEvent(label, err instanceof Error ? err.message : String(err)));
      })
      .finally(() => {
        clearInterval(liveFlush);
        if (state.stuckTimer) {
          clearTimeout(state.stuckTimer);
          state.stuckTimer = null;
        }
        if (state.turnSeq !== seq) return;
        state.busy = false;
        ctx.turn?.("idle");
        drainQueue(state, ctx);
        });
        }

  async function spawnAgent(ctx: AdapterContext, extraEnv?: Record<string, string>): Promise<WorkerProcess> {
    return ctx.spawnWorker(command!, { stdin: "pipe", persistent: true, env: { ...env, ...extraEnv } });
  }

  const adapter: Adapter = {
    id: "acp",
    version: "0.1.0",

    capabilities(): AdapterCapabilities {
      return {
        reasoning: true,
        tools: true,
        cost: false,
        steer: true,
        usage: false,
        ...(cfg.contextWindowTokens !== undefined ? { contextWindowTokens: cfg.contextWindowTokens } : {}),
        nativeDiscovery: "none",
        nativeResume: "none",
        // ADR-0018: tools are asked per call through request_permission —
        // as far as the agent asks (see the presets and docs/harness-matrix.md).
        // T7.10: images as content blocks when the agent says it takes them,
        // otherwise (and for other files) their text.
        features: basicFeatures({ toolGate: cfg.permissions === "hub" ? "native" : "allowlist", images: !(preset && "images" in preset && !preset.images), files: true, modelChoice: preset && "models" in preset && !preset.models ? "none" : "start" }),
      };
    },

    /** ADR-0018: the model catalog for the start form — one provider/model
     * per line from a listing command. Derived for `… acp` agents (opencode:
     * `opencode models`), explicit via `modelsCommand`. Same line shape as
     * adapter-opencode's parseModelList (kept local, 8 lines). */
    async models(): Promise<ModelOption[]> {
      // dsh ≥ 0.2 has no listing command; its ACP session offers every provider and model.
      if (!cfg.modelsCommand && cfg.preset === "dsh" && command) return probeModelCatalog(command, env);
      const cmd = cfg.modelsCommand ?? (command?.at(-1) === "acp" ? [...command.slice(0, -1), "models"] : undefined);
      if (!cmd) return [];
      const { stdout } = await run(cmd[0]!, cmd.slice(1), { timeout: 20_000, maxBuffer: 1024 * 1024 });
      return stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^[\w.-]+\/\S+$/.test(line))
        .map((id) => ({ id }));
    },

    async start(spec: SessionSpec, ctx: AdapterContext): Promise<SessionHandle> {
      const proc = await spawnAgent(ctx, spec.env);
      const state = connect(ctx.sessionId, proc, ctx);
      const caps = await initialize(state);
      // continueStopped hands the native id as args.resumeSessionId — the
      // continued turn runs in the loaded conversation, not a fresh one.
      // BUG-0039: adoption sends importHistory along — the replay is then
      // the session's only history and goes to the stream.
      const startArgs = (spec.args ?? {}) as { resumeSessionId?: unknown; importHistory?: unknown };
      const resume = startArgs.resumeSessionId;
      try {
        if (typeof resume === "string" && resume && (await resumeNative(state, ctx, resume, caps.loadSession, startArgs.importHistory === true))) {
          // loaded — the prompt (if any) continues the old conversation
        } else {
          if (typeof resume === "string" && resume) {
            ctx.emit({ type: "system", summary: `${label}: Agent kann Sessions nicht laden — neuer Kontext`, payload: { kind: "acp.context_lost" } });
          }
          await newSession(state, ctx, spec.model ?? cfg.model);
        }
      } catch (err) {
        await state.proc.kill("SIGTERM");
        sessions.delete(ctx.sessionId);
        throw err;
      }
      if (spec.prompt || spec.attachments?.length) runTurn(state, ctx, spec.prompt ?? "", spec.attachments);
      return { sessionId: ctx.sessionId, ...(proc.pid !== undefined ? { pid: proc.pid } : {}) };
    },

    async steer(handle: SessionHandle, input: SteerInput, ctx: AdapterContext): Promise<Ack> {
      const state = sessions.get(handle.sessionId);
      switch (input.kind) {
        case "prompt":
          if (!state || !state.healthy) return { ok: false, detail: `${label}: Agent läuft nicht mehr — Session neu starten` };
          if (state.busy) {
            // EPIC-P7 follow-up: a prompt while a turn runs is parked in the
            // FIFO queue and delivered when the turn ends — the phone never
            // has to wait for the agent to finish before typing.
            state.queued.push({ text: input.text, ...(input.attachments?.length ? { attachments: input.attachments } : {}) });
            ctx.emit({ type: "system", summary: `${label}: Nachricht wartet bis der Zug endet (${state.queued.length} in der Warteschlange)`, payload: { kind: "acp.queued", queued: state.queued.length } });
            return { ok: true, detail: "in der Warteschlange — wird nach dem Zug gesendet" };
          }
          runTurn(state, ctx, input.text, input.attachments);
          return { ok: true };
        case "park":
          if (state?.acpSessionId) state.conn.notify("session/cancel", { sessionId: state.acpSessionId });
          if (state?.queued.length) {
            ctx.emit({ type: "system", summary: `${label}: ${state.queued.length} wartende Nachricht(en) verworfen — Session geparkt`, payload: { kind: "acp.queued_dropped", count: state.queued.length } });
            state.queued = [];
          }
          return { ok: true };
        case "stop":
          await adapter.stop(handle, ctx);
          return { ok: true };
        case "configure":
          return { ok: false, detail: "acp: Modus und Modell lassen sich in dieser Session nicht wechseln" };
        case "resume":
          return { ok: false, detail: `${label}: weiter geht es mit einem neuen Prompt` };
      }
    },

    async status(handle: SessionHandle): Promise<HealthReport> {
      const state = sessions.get(handle.sessionId);
      if (!state) return { state: "down", detail: "no agent process" };
      return { state: state.healthy ? "healthy" : "down", lastSeen: new Date().toISOString() };
    },

    /**
     * ADR-0014 for a persistent agent: take over the process that survived
     * the restart. A turn that was waiting for a permission answer can't be
     * answered any more (the request was read by the previous hub) — it is
     * cancelled, visibly. Without a surviving process: a new agent, which
     * loads the session when the agent can.
     */
    async recover(sessionId: string, _lastSeq: number, ctx: AdapterContext): Promise<SessionHandle | null> {
      const native = ctx.nativeSessionId ?? null;
      const adopted = (await ctx.adoptWorker?.({ persistent: true })) ?? null;
      if (adopted) {
        const state = connect(sessionId, adopted, ctx);
        state.acpSessionId = native;
        if (native) {
          state.conn.notify("session/cancel", { sessionId: native });
          ctx.emit({ type: "system", summary: `${label}: nach dem Hub-Neustart übernommen, laufender Zug abgebrochen`, payload: { kind: "acp.recovered", cancelled: true } });
        }
        return { sessionId, ...(adopted.pid !== undefined ? { pid: adopted.pid } : {}) };
      }
      if (!native) return null;
      const proc = await spawnAgent(ctx);
      const state = connect(sessionId, proc, ctx);
      const caps = await initialize(state);
      // BUG-0036: resumeNative silences the load replay; an agent without
      // load support starts a fresh context, visibly.
      if (!(await resumeNative(state, ctx, native, caps.loadSession))) {
        if (caps.resume) {
          state.replay = true;
          try {
            await state.conn.request("session/resume", { sessionId: native, cwd: ctx.workdir, mcpServers: [] }, cfg.startupTimeoutMs);
          } finally {
            state.replay = false;
            state.mapper.flush();
          }
          state.acpSessionId = native;
          announce(ctx, native);
        } else {
          await newSession(state, ctx);
          ctx.emit({ type: "system", summary: `${label}: Agent kann Sessions nicht laden — neuer Kontext`, payload: { kind: "acp.context_lost" } });
        }
      }
      return { sessionId, ...(proc.pid !== undefined ? { pid: proc.pid } : {}) };
    },

    async stop(handle: SessionHandle): Promise<void> {
      const state = sessions.get(handle.sessionId);
      if (!state) return;
      if (state.acpSessionId) state.conn.notify("session/cancel", { sessionId: state.acpSessionId });
      await state.proc.kill("SIGTERM");
      await state.proc.kill("SIGKILL");
      sessions.delete(handle.sessionId);
    },
  };
  return adapter;
}
