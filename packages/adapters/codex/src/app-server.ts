import { spawn } from "node:child_process";
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
import { JsonRpcConnection, RpcError } from "@uacc/adapter-jsonrpc";
import { itemCompleted, itemStarted, planEvent, quotaOf, toolOf, type CodexItem } from "./app-server-events.ts";
import { estimateCostUsd } from "./pricing.ts";

/**
 * codex in app-server mode (T7.2, ADR-0018 §3): one `codex app-server`
 * per session as a persistent worker (stdin pipe). Commands and file
 * changes ask the phone first (`approvalPolicy: "untrusted"`), questions
 * (`request_user_input`) are answered there, quota comes from
 * `account/rateLimits` — none of which `codex exec` offers.
 */
export interface AppServerConfig {
  command: string;
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
  approvalPolicy: "untrusted" | "on-request" | "never";
  extraArgs: string[];
}

interface ServerSession {
  proc: WorkerProcess;
  conn: JsonRpcConnection;
  threadId: string | null;
  turnId: string | null;
  model: string | undefined;
  healthy: boolean;
  items: Map<string, CodexItem>;
}

export function createAppServerAdapter(cfg: AppServerConfig): Adapter {
  const sessions = new Map<string, ServerSession>();
  const command = [cfg.command, "app-server", ...cfg.extraArgs];

  async function ask(ctx: AdapterContext, state: ServerSession, method: string, params: Record<string, unknown>): Promise<unknown> {
    if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") {
      const item = state.items.get(String(params.itemId)) ?? { type: method.includes("fileChange") ? "fileChange" : "commandExecution", command: params.command as string };
      const tool = toolOf({ ...item, ...(typeof params.command === "string" ? { command: params.command } : {}) }) ?? { name: "Werkzeug", input: {} };
      if (!ctx.requestToolPermission) return { decision: "decline" };
      const answer = await ctx.requestToolPermission({
        toolName: tool.name,
        input: { ...tool.input, ...(typeof params.reason === "string" ? { reason: params.reason } : {}) },
        toolUseId: String(params.approvalId ?? params.itemId),
      });
      // Never "acceptForSession": each call is its own decision (ADR-0018).
      return { decision: answer.behavior === "allow" ? "accept" : "decline" };
    }
    if (method === "item/tool/requestUserInput") {
      const questions = (params.questions as { id: string; header?: string; question: string; options?: { label: string; description?: string }[] }[]) ?? [];
      if (!ctx.requestToolPermission) return { answers: {} };
      const answer = await ctx.requestToolPermission({
        toolName: "AskUserQuestion",
        input: { questions: questions.map((q) => ({ question: q.question, header: q.header, options: q.options ?? [], multiSelect: false })) },
        toolUseId: String(params.itemId),
      });
      const given = answer.behavior === "allow" ? ((answer.updatedInput.answers ?? {}) as Record<string, string>) : {};
      return { answers: Object.fromEntries(questions.filter((q) => given[q.question]).map((q) => [q.id, { answers: [given[q.question]!] }])) };
    }
    throw new RpcError(-32601, `${method} wird vom Hub nicht angeboten`);
  }

  function connect(sessionId: string, proc: WorkerProcess, ctx: AdapterContext, model: string | undefined): ServerSession {
    const state: ServerSession = { proc, conn: null as unknown as JsonRpcConnection, threadId: null, turnId: null, model, healthy: true, items: new Map() };
    state.conn = new JsonRpcConnection((line) => proc.write(line), {
      onNotification: (method, raw) => {
        const params = (raw ?? {}) as Record<string, unknown>;
        if (params.threadId && state.threadId && params.threadId !== state.threadId) return;
        switch (method) {
          case "item/started": {
            const item = params.item as CodexItem;
            if (item.id) state.items.set(item.id, item);
            for (const e of itemStarted(item)) ctx.emit(e);
            break;
          }
          case "item/completed":
            for (const e of itemCompleted(params.item as CodexItem)) ctx.emit(e);
            break;
          case "turn/plan/updated":
            ctx.emit(planEvent((params.plan as { step: string; status: string }[]) ?? []));
            break;
          case "thread/tokenUsage/updated": {
            const last = (params.tokenUsage as { last?: { inputTokens?: number; cachedInputTokens?: number; outputTokens?: number; totalTokens?: number } })?.last;
            if (last) {
              const cost = estimateCostUsd(state.model, last);
              ctx.emit({ type: "system", summary: `codex: ${last.totalTokens ?? "?"} Tokens`, payload: { kind: "codex.token_usage" }, ...(typeof last.totalTokens === "number" ? { tokensEst: last.totalTokens } : {}), ...(cost !== undefined ? { costUsd: cost } : {}) });
            }
            break;
          }
          case "account/rateLimits/updated": {
            const quota = quotaOf(params.rateLimits as Parameters<typeof quotaOf>[0]);
            if (quota) ctx.emit({ type: "system", summary: "codex: Kontingent aktualisiert", payload: { kind: "codex.rate_limits" }, usageQuota: quota });
            break;
          }
          case "error": {
            const err = params.error as { message?: string } | undefined;
            if (params.willRetry !== true && err?.message) ctx.emit(providerErrorEvent("codex", err.message));
            break;
          }
          case "turn/completed": {
            const turn = params.turn as { status?: string; error?: { message?: string } | null };
            ctx.emit({ type: "system", summary: `codex: Zug beendet (${turn.status ?? "?"})`, payload: { kind: "codex.turn_end", status: turn.status ?? null } });
            if (turn.status === "failed" && turn.error?.message) ctx.emit(providerErrorEvent("codex", turn.error.message));
            state.turnId = null;
            ctx.turn?.("idle");
            break;
          }
        }
      },
      onRequest: (method, params) => ask(ctx, state, method, (params ?? {}) as Record<string, unknown>),
      onNoise: (line) => ctx.log("debug", "codex app-server: non-JSON output", { line: line.slice(0, 300) }),
    });
    proc.onStdout((chunk) => state.conn.feed(chunk));
    proc.onExit((code) => {
      state.healthy = false;
      state.conn.failAll(`codex app-server beendet (Code ${code ?? "?"})`);
      if (code !== 0 && code !== null) ctx.emit({ type: "system", summary: `codex: process exited with code ${code}`, payload: { code } });
      if (state.turnId) {
        state.turnId = null;
        ctx.turn?.("idle");
      }
      if (sessions.get(sessionId) === state) sessions.delete(sessionId);
    });
    sessions.set(sessionId, state);
    return state;
  }

  async function initialize(state: ServerSession): Promise<void> {
    await state.conn.request("initialize", { clientInfo: { name: "uacc-hub", version: "0.1.0" } }, 60_000);
    state.conn.notify("initialized", {});
    // ADR-0004: the account quota, once per session start.
    void state.conn.request("account/rateLimits/read", {}, 20_000).catch(() => undefined);
  }

  function threadParams(ctx: AdapterContext, model: string | undefined): Record<string, unknown> {
    return { cwd: ctx.workdir, approvalPolicy: cfg.approvalPolicy, sandbox: cfg.sandbox, ...(model ? { model } : {}) };
  }

  /** T7.10: images as `localImage` input, everything else as text. */
  function inputOf(text: string, attachments: readonly PromptAttachment[] | undefined): Record<string, unknown>[] {
    const images = (attachments ?? []).filter((a) => a.kind === "image");
    const native = new Set(images.map((a) => a.id));
    return [{ type: "text", text: promptWithAttachments(text, attachments, native) }, ...images.map((a) => ({ type: "localImage", path: a.path }))];
  }

  async function startTurn(state: ServerSession, ctx: AdapterContext, text: string, attachments?: readonly PromptAttachment[]): Promise<void> {
    ctx.turn?.("working");
    try {
      const res = (await state.conn.request("turn/start", { threadId: state.threadId, input: inputOf(text, attachments) })) as { turn?: { id?: string } };
      state.turnId = res.turn?.id ?? null;
    } catch (err) {
      ctx.emit(providerErrorEvent("codex", err instanceof Error ? err.message : String(err)));
      ctx.turn?.("idle");
    }
  }

  const adapter: Adapter = {
    id: "codex",
    version: "0.2.0",

    capabilities(): AdapterCapabilities {
      return {
        reasoning: true,
        tools: true,
        cost: true,
        steer: true,
        usage: true,
        nativeDiscovery: "none",
        nativeResume: "native",
        features: basicFeatures({
          toolGate: cfg.approvalPolicy === "never" ? (cfg.sandbox === "danger-full-access" ? "bypass" : "sandbox") : "native",
          questions: cfg.approvalPolicy !== "never",
          modelChoice: "start",
          images: true,
          files: true,
        }),
      };
    },

    /** ADR-0018: `model/list` of a short-lived app-server (read-only listing). */
    async models(): Promise<ModelOption[]> {
      return listModels(cfg.command);
    },

    async start(spec: SessionSpec, ctx: AdapterContext): Promise<SessionHandle> {
      const proc = await ctx.spawnWorker(command, { stdin: "pipe", persistent: true, ...(spec.env ? { env: spec.env } : {}) });
      const state = connect(ctx.sessionId, proc, ctx, spec.model);
      await initialize(state);
      const started = (await state.conn.request("thread/start", threadParams(ctx, spec.model), 60_000)) as { thread?: { id?: string }; model?: string };
      state.threadId = started.thread?.id ?? null;
      state.model = spec.model ?? started.model;
      if (state.threadId) ctx.emit({ type: "system", summary: `Codex · Thread ${state.threadId}`, payload: { kind: "codex.native_session", nativeSessionId: state.threadId, model: started.model ?? null } });
      if (spec.prompt || spec.attachments?.length) await startTurn(state, ctx, spec.prompt ?? "", spec.attachments);
      return { sessionId: ctx.sessionId, ...(proc.pid !== undefined ? { pid: proc.pid } : {}) };
    },

    async steer(handle: SessionHandle, input: SteerInput, ctx: AdapterContext): Promise<Ack> {
      const state = sessions.get(handle.sessionId);
      switch (input.kind) {
        case "prompt":
          if (!state?.healthy || !state.threadId) return { ok: false, detail: "codex: app-server läuft nicht mehr — Session neu starten" };
          if (state.turnId) {
            // A running turn takes the text as steering input.
            await state.conn.request("turn/steer", { threadId: state.threadId, turnId: state.turnId, input: [{ type: "text", text: input.text }] }).catch(() => undefined);
            return { ok: true };
          }
          await startTurn(state, ctx, input.text, input.attachments);
          return { ok: true };
        case "park":
          if (state?.threadId && state.turnId) await state.conn.request("turn/interrupt", { threadId: state.threadId, turnId: state.turnId }).catch(() => undefined);
          return { ok: true };
        case "stop":
          await adapter.stop(handle, ctx);
          return { ok: true };
        case "resume":
          return { ok: false, detail: "codex: weiter geht es mit einem neuen Prompt" };
      }
    },

    async status(handle: SessionHandle): Promise<HealthReport> {
      const state = sessions.get(handle.sessionId);
      if (!state) return { state: "down", detail: "no app-server process" };
      return { state: state.healthy ? "healthy" : "down", lastSeen: new Date().toISOString() };
    },

    /** ADR-0014: take over the surviving app-server; else start one and
     * resume the thread natively. */
    async recover(sessionId: string, _lastSeq: number, ctx: AdapterContext): Promise<SessionHandle | null> {
      const native = ctx.nativeSessionId ?? null;
      const adopted = (await ctx.adoptWorker?.({ persistent: true })) ?? null;
      if (adopted) {
        const state = connect(sessionId, adopted, ctx, undefined);
        state.threadId = native;
        return { sessionId, ...(adopted.pid !== undefined ? { pid: adopted.pid } : {}) };
      }
      if (!native) return null;
      const proc = await ctx.spawnWorker(command, { stdin: "pipe", persistent: true });
      const state = connect(sessionId, proc, ctx, undefined);
      await initialize(state);
      await state.conn.request("thread/resume", { threadId: native, ...threadParams(ctx, undefined) }, 60_000);
      state.threadId = native;
      return { sessionId, ...(proc.pid !== undefined ? { pid: proc.pid } : {}) };
    },

    async stop(handle: SessionHandle): Promise<void> {
      const state = sessions.get(handle.sessionId);
      if (!state) return;
      await state.proc.kill("SIGTERM");
      await state.proc.kill("SIGKILL");
      sessions.delete(handle.sessionId);
    },
  };
  return adapter;
}

/** `model/list` from a short-lived `codex app-server`, 20 s at most. */
export function listModels(commandName: string): Promise<ModelOption[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(commandName, ["app-server"], { stdio: ["pipe", "pipe", "ignore"] });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("codex model/list: keine Antwort"));
    }, 20_000);
    const conn = new JsonRpcConnection((line) => child.stdin.write(line), { onNotification: () => undefined, onRequest: async () => null });
    child.stdout.setEncoding("utf8").on("data", (c: string) => conn.feed(c));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    void (async () => {
      await conn.request("initialize", { clientInfo: { name: "uacc-hub", version: "0.1.0" } });
      conn.notify("initialized", {});
      const res = (await conn.request("model/list", {})) as { data?: { id: string; displayName?: string; hidden?: boolean }[] };
      clearTimeout(timer);
      child.kill("SIGTERM");
      resolve((res.data ?? []).filter((m) => !m.hidden).map((m) => ({ id: m.id, ...(m.displayName ? { label: m.displayName } : {}) })));
    })().catch((err: unknown) => {
      clearTimeout(timer);
      child.kill("SIGKILL");
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}
