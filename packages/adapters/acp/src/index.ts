import { z } from "zod";
import {
  basicFeatures,
  providerErrorEvent,
  type Ack,
  type Adapter,
  type AdapterCapabilities,
  type AdapterContext,
  type HealthReport,
  type SessionHandle,
  type SessionSpec,
  type SteerInput,
  type WorkerProcess,
} from "@uacc/contracts";
import { JsonRpcConnection as AcpConnection, RpcError } from "@uacc/adapter-jsonrpc";
import { UpdateMapper, type SessionUpdate } from "./normalize.ts";

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
 *   permissions: "hub" (default) — ask the phone; "reject" — deny all.
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
 * shell commands — by default it would run them unasked (ADR-0018). */
export const ACP_PRESETS = {
  copilot: { command: ["copilot", "--acp"], env: {} },
  opencode: {
    command: ["opencode", "acp"],
    env: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: { edit: "ask", bash: "ask", webfetch: "ask" } }) },
  },
  dsh: { command: ["dsh", "--profile", "acp"], env: {} },
} as const satisfies Record<string, { command: string[]; env: Record<string, string> }>;

const AcpConfig = z.object({
  preset: z.enum(["copilot", "opencode", "dsh"]).optional(),
  command: z.array(z.string().min(1)).min(1).optional(),
  env: z.record(z.string()).default({}),
  label: z.string().min(1).optional(),
  permissions: z.enum(["hub", "reject"]).default("hub"),
  /** How long initialize/session setup may take (npx may download first). */
  startupTimeoutMs: z.number().int().positive().default(120_000),
});

const PROTOCOL_VERSION = 1;

interface AgentSession {
  proc: WorkerProcess;
  conn: AcpConnection;
  acpSessionId: string | null;
  busy: boolean;
  mapper: UpdateMapper;
  healthy: boolean;
}

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

  /** ACP permission request → the phone → the option the agent offered. */
  async function decidePermission(ctx: AdapterContext, params: unknown): Promise<unknown> {
    const p = params as { toolCall?: { toolCallId?: string; title?: string | null; name?: string | null; kind?: string | null; rawInput?: unknown }; options?: { optionId: string; kind: string }[] };
    const options = p.options ?? [];
    const pick = (kinds: string[]) => kinds.map((k) => options.find((o) => o.kind === k)).find(Boolean);
    const deny = () => {
      const reject = pick(["reject_once", "reject_always"]);
      return reject ? { outcome: { outcome: "selected", optionId: reject.optionId } } : { outcome: { outcome: "cancelled" } };
    };
    if (cfg.permissions !== "hub" || !ctx.requestToolPermission) return deny();
    const call = p.toolCall ?? {};
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
    const state: AgentSession = { proc, conn: null as unknown as AcpConnection, acpSessionId: null, busy: false, mapper: new UpdateMapper(label), healthy: true };
    state.conn = new AcpConnection((line) => proc.write(line), {
      onNotification: (method, params) => {
        if (method !== "session/update") return;
        const update = (params as { update?: SessionUpdate }).update;
        if (update) emitAll(ctx, state.mapper.map(update));
      },
      onRequest: async (method, params) => {
        if (method === "session/request_permission") return decidePermission(ctx, params);
        throw new RpcError(-32601, `${method} wird vom Hub nicht angeboten`);
      },
      // A prompt sent by the hub before a restart ends here — the turn is over.
      onStrayResult: (result) => {
        if (result && typeof result === "object" && "stopReason" in result) {
          emitAll(ctx, state.mapper.flush());
          state.busy = false;
          ctx.turn?.("idle");
        }
      },
      onNoise: (line) => ctx.log("debug", `${label}: non-JSON output`, { line: line.slice(0, 300) }),
    });
    proc.onStdout((chunk) => state.conn.feed(chunk));
    proc.onExit((code) => {
      state.healthy = false;
      state.conn.failAll(`${label}-Prozess beendet (Code ${code ?? "?"})`);
      emitAll(ctx, state.mapper.flush());
      if (code !== 0 && code !== null) ctx.emit({ type: "system", summary: `${label}: process exited with code ${code}`, payload: { code } });
      if (state.busy) {
        state.busy = false;
        ctx.turn?.("idle");
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
    )) as { agentCapabilities?: { loadSession?: boolean; sessionCapabilities?: { resume?: unknown } } };
    return { loadSession: init.agentCapabilities?.loadSession === true, resume: Boolean(init.agentCapabilities?.sessionCapabilities?.resume) };
  }

  function announce(ctx: AdapterContext, acpSessionId: string): void {
    ctx.emit({ type: "system", summary: `${label} · Session ${acpSessionId}`, payload: { kind: "acp.native_session", nativeSessionId: acpSessionId } });
  }

  async function newSession(state: AgentSession, ctx: AdapterContext): Promise<void> {
    const res = (await state.conn.request("session/new", { cwd: ctx.workdir, mcpServers: [] }, cfg.startupTimeoutMs)) as { sessionId: string };
    state.acpSessionId = res.sessionId;
    announce(ctx, res.sessionId);
  }

  function runTurn(state: AgentSession, ctx: AdapterContext, text: string): void {
    state.busy = true;
    ctx.turn?.("working");
    void state.conn
      .request("session/prompt", { sessionId: state.acpSessionId, prompt: [{ type: "text", text }] })
      .then((res) => {
        const r = res as { stopReason?: string; usage?: { totalTokens?: number } | null };
        emitAll(ctx, state.mapper.flush());
        ctx.emit({
          type: "system",
          summary: `${label}: Zug beendet (${r.stopReason ?? "?"})`,
          payload: { kind: "acp.turn_end", stopReason: r.stopReason ?? null },
          ...(typeof r.usage?.totalTokens === "number" ? { tokensEst: r.usage.totalTokens } : {}),
        });
        if (r.stopReason === "refusal") ctx.emit(providerErrorEvent(label, "Der Agent hat die Anfrage abgelehnt (refusal)."));
      })
      .catch((err: unknown) => {
        emitAll(ctx, state.mapper.flush());
        ctx.emit(providerErrorEvent(label, err instanceof Error ? err.message : String(err)));
      })
      .finally(() => {
        state.busy = false;
        ctx.turn?.("idle");
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
        nativeDiscovery: "none",
        nativeResume: "none",
        // ADR-0018: tools are asked per call through request_permission —
        // as far as the agent asks (see the presets and docs/harness-matrix.md).
        features: basicFeatures({ toolGate: cfg.permissions === "hub" ? "native" : "allowlist" }),
      };
    },

    async start(spec: SessionSpec, ctx: AdapterContext): Promise<SessionHandle> {
      const proc = await spawnAgent(ctx, spec.env);
      const state = connect(ctx.sessionId, proc, ctx);
      await initialize(state);
      await newSession(state, ctx);
      if (spec.prompt) runTurn(state, ctx, spec.prompt);
      return { sessionId: ctx.sessionId, ...(proc.pid !== undefined ? { pid: proc.pid } : {}) };
    },

    async steer(handle: SessionHandle, input: SteerInput, ctx: AdapterContext): Promise<Ack> {
      const state = sessions.get(handle.sessionId);
      switch (input.kind) {
        case "prompt":
          if (!state || !state.healthy) return { ok: false, detail: `${label}: Agent läuft nicht mehr — Session neu starten` };
          if (state.busy) return { ok: false, detail: `${label}: der Zug läuft noch — erst anhalten oder abwarten` };
          runTurn(state, ctx, input.text);
          return { ok: true };
        case "park":
          if (state?.acpSessionId) state.conn.notify("session/cancel", { sessionId: state.acpSessionId });
          return { ok: true };
        case "stop":
          await adapter.stop(handle, ctx);
          return { ok: true };
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
      if (caps.loadSession) {
        await state.conn.request("session/load", { sessionId: native, cwd: ctx.workdir, mcpServers: [] }, cfg.startupTimeoutMs);
        state.acpSessionId = native;
      } else if (caps.resume) {
        await state.conn.request("session/resume", { sessionId: native, cwd: ctx.workdir, mcpServers: [] }, cfg.startupTimeoutMs);
        state.acpSessionId = native;
      } else {
        await newSession(state, ctx);
        ctx.emit({ type: "system", summary: `${label}: Agent kann Sessions nicht laden — neuer Kontext`, payload: { kind: "acp.context_lost" } });
      }
      state.mapper.flush(); // replayed history is already in the hub's tail
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
