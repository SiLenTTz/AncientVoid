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
import { basicFeatures, promptWithAttachments, providerErrorEvent } from "@ancientvoid/contracts";
import { contextWindowFor } from "@ancientvoid/models";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { normalizeCursorLine, type CursorLine } from "./normalize.ts";

const run = promisify(execFile);

/**
 * cursor adapter: the `cursor-agent` CLI (ships with Cursor, ~/.local/bin).
 * One `-p --output-format stream-json` run per turn — the same shape the
 * opencode CLI adapter uses. Native continuation via `--resume <chatId>`.
 *
 * Config (hub.config.json → adapters[].config):
 *   command:  executable (default "cursor-agent")
 *   extraArgs: extra CLI args verbatim
 *   model:    default model (--model), e.g. "claude-sonnet-5"
 *   mode:     "ask" (read-only Q&A) | "plan" | omitted = full agent.
 *             Full agent runs unasked in -p mode — toolGate stays "allowlist".
 */
const CursorConfig = z.object({
  command: z.string().min(1).default("cursor-agent"),
  extraArgs: z.array(z.string()).default([]),
  /** Live 2026-09-29: ohne --model greift der Konto-Default (Max-Mode-Modell,
   * out of usage → Exit 1). Der CLI-eigene "default" ist auto, nicht was das
   * Konto durchreicht — deshalb explizit auto. */
  model: z.string().min(1).default("auto"),
  mode: z.enum(["ask", "plan"]).optional(),
  /** ADR-0032: curated fallback if the chosen model has no known window. */
  contextWindowTokens: z.number().int().positive().optional(),
});
type CursorConfig = z.infer<typeof CursorConfig>;

const OpencodeStyleArgs = z.object({
  resumeSessionId: z.string().min(1).optional(),
});

interface SessionMeta {
  healthy: boolean;
  resumeSessionId: string | null;
  lastModel: string | null;
}

export function createAdapter(config?: Readonly<Record<string, unknown>>): Adapter {
  const cfg = CursorConfig.parse(config ?? {});
  const sessions = new Map<string, SessionMeta>();

  function buildArgs(prompt: string, resume: string | undefined, model: string | undefined): string[] {
    // --trust: the hub runs in fresh worktrees — without it the CLI stops
    // and asks for workspace trust interactively (verified live).
    const args = ["-p", "--output-format", "stream-json", "--trust"];
    if (resume) args.push("--resume", resume);
    if (model && !resume) args.push("--model", model);
    if (cfg.mode) args.push("--mode", cfg.mode);
    args.push(...cfg.extraArgs, "--", prompt);
    return args;
  }

  function attach(sessionId: string, proc: WorkerProcess, ctx: AdapterContext, meta: SessionMeta): void {
    sessions.set(sessionId, meta);
    let buffer = "";
    const lineState = { thinking: "" };
    proc.onStdout((chunk) => {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let parsed: CursorLine;
        try {
          parsed = JSON.parse(line) as CursorLine;
        } catch {
          // ActionRequiredError ("You've hit your usage limit" / "out of usage")
          // is Cursor's account limit. It must be a provider.error (ADR-0015),
          // otherwise the turn looks interrupted and a promptless resume
          // leaves the session "working" with no visible failure (BUG-0149).
          const usage = /out of usage|ActionRequiredError|hit your usage limit|usage limit/i.test(line);
          if (usage) ctx.emit(providerErrorEvent("cursor", line));
          else {
            ctx.emit({
              type: "system",
              summary: "cursor: non-JSON stdout line",
              payload: { kind: "cursor.noise", line: line.slice(0, 500) },
            });
          }
          continue;
        }
        for (const e of normalizeCursorLine(parsed, lineState)) {
          if ((e.payload as { kind?: string }).kind === "cursor.native_session") {
            const native = (e.payload as { nativeSessionId?: string }).nativeSessionId;
            if (native) meta.resumeSessionId = native;
          }
          ctx.emit(e);
        }
      }
    });
    proc.onExit((code) => {
      // cursor-agent -p is one-shot per turn, same as claude -p — a clean
      // exit is the turn finishing normally, not the adapter going down.
      if (code !== 0 && code !== null) {
        meta.healthy = false;
        ctx.emit({ type: "system", summary: `cursor: process exited with code ${code}`, payload: { code } });
      }
    });
  }

  const adapter: Adapter = {
    id: "cursor",
    version: "0.1.0",

    capabilities(): AdapterCapabilities {
      return {
        promptDelivery: "next-turn",
        reasoning: true,
        tools: true,
        // live verified 2026-09-29: cursor-agent reports tokens (camelCase
        // usage) but no cost — "nicht gemeldet" stays honest until it does.
        cost: false,
        steer: true,
        usage: false,
        ...(cfg.contextWindowTokens !== undefined ? { contextWindowTokens: cfg.contextWindowTokens } : {}),
        nativeDiscovery: "none",
        nativeResume: "native",
        // EPIC-P35 / BUG-Weitermachen: `--resume <chatId>` ist der gleiche Pfad
        // wie Follow-up-Steers; hub:true schaltet den Banner-Button frei.
        // Promptloses Weitermachen bleibt idle (kein leerer -p-Zug), nächster Prompt resumed.
        resume: { argv: [cfg.command, "--resume", "{sessionId}"], ref: "native", hub: true, auto: true },
        features: basicFeatures({ toolGate: cfg.extraArgs.includes("--yolo") || cfg.extraArgs.includes("--force") ? "bypass" : "allowlist", modelChoice: "start" }),
      };
    },

    /** `cursor-agent --list-models` prints `id - Label` lines (live:
     * `auto - Auto (default)` first). */
    async models(): Promise<ModelOption[]> {
      const { stdout } = await run(cfg.command, ["--list-models"], { timeout: 20_000, maxBuffer: 1024 * 1024 });
      return stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .flatMap((line) => {
          const m = /^([\w.-]+)\s+-\s+(.+)$/.exec(line);
          return m ? [{ id: m[1]!, label: m[2]! }] : [];
        });
    },

    async start(spec: SessionSpec, ctx: AdapterContext): Promise<SessionHandle> {
      const args = OpencodeStyleArgs.safeParse(spec.args);
      const resume = args.success ? args.data?.resumeSessionId : undefined;
      const model = spec.model ?? cfg.model;
      const meta: SessionMeta = { healthy: true, resumeSessionId: resume ?? null, lastModel: model ?? null };
      if (model) {
        const window = contextWindowFor(model);
        ctx.emit({ type: "system", summary: `cursor · ${model}`, payload: { kind: "cursor.model", model, ...(window !== null ? { contextWindowTokens: window } : {}) } });
      }
      // Weitermachen / Adoption ohne Prompt: kein leerer -p-Zug (wie claude ADR-0040).
      // Der nächste steer-Prompt setzt mit --resume fort.
      if (resume && !spec.prompt?.trim() && !spec.attachments?.length) {
        sessions.set(ctx.sessionId, meta);
        return { sessionId: ctx.sessionId };
      }
      const prompt = promptWithAttachments(spec.prompt ?? "", spec.attachments as readonly PromptAttachment[] | undefined);
      const proc = await ctx.spawnWorker([cfg.command, ...buildArgs(prompt, resume, model)], spec.env ? { env: spec.env } : undefined);
      attach(ctx.sessionId, proc, ctx, meta);
      return { sessionId: ctx.sessionId, ...(proc.pid !== undefined ? { pid: proc.pid } : {}) };
    },

    async steer(handle: SessionHandle, input: SteerInput, ctx: AdapterContext): Promise<Ack> {
      const meta = sessions.get(handle.sessionId);
      switch (input.kind) {
        case "prompt": {
          // Nach promptlosem Weitermachen existiert meta, healthy bleibt true ohne Prozess.
          if (!meta) return { ok: false, detail: "cursor: Agent läuft nicht mehr — Session neu starten" };
          if (!meta.healthy && !meta.resumeSessionId) return { ok: false, detail: "cursor: Agent läuft nicht mehr — Session neu starten" };
          meta.healthy = true;
          const prompt = promptWithAttachments(input.text, input.attachments as readonly PromptAttachment[] | undefined);
          const proc = await ctx.spawnWorker([cfg.command, ...buildArgs(prompt, meta.resumeSessionId ?? undefined, meta.lastModel ?? undefined)], undefined);
          attach(handle.sessionId, proc, ctx, meta);
          return { ok: true };
        }
        case "park":
          return { ok: false, detail: "cursor: Ein laufender -p-Zug lässt sich nicht anhalten — warten oder stoppen" };
        case "stop":
          await adapter.stop(handle, ctx);
          return { ok: true };
        case "configure":
          return { ok: false, detail: "cursor: Modus und Modell lassen sich in dieser Session nicht wechseln" };
        case "resume":
          return { ok: false, detail: "cursor: weiter geht es mit einem neuen Prompt" };
      }
    },

    async status(handle: SessionHandle): Promise<HealthReport> {
      const meta = sessions.get(handle.sessionId);
      if (!meta) return { state: "down", detail: "no agent process" };
      return { state: meta.healthy ? "healthy" : "down", lastSeen: new Date().toISOString() };
    },

    async stop(handle: SessionHandle): Promise<void> {
      const meta = sessions.get(handle.sessionId);
      if (!meta) return;
      meta.healthy = false;
      sessions.delete(handle.sessionId);
    },
  };
  return adapter;
}

export { normalizeCursorLine };
