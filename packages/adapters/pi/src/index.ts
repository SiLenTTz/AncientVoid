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
 * pi adapter (pi coding agent, badlogic/pi). Spawns `pi exec --continue`
 * per turn — pi keeps its own session state in ~/.pi/agent/sessions keyed
 * by cwd, so consecutive turns in the same project continue the thread.
 *
 * Verified behaviour (evox2 + zeratul, 2026-10-25):
 * - headless ONLY without a pty; the hub's tmux worker provides one, but
 *   pi exec exits fine when stdin is not a terminal — it never blocks.
 * - model choice via `--model provider/id`; custom providers from
 *   ~/.pi/agent/models.json (providers-OBJECT, apiKey directly).
 *
 * Config (hub.config.json -> adapters[].config):
 *   command:   executable (default "pi").
 *   extraArgs: extra CLI args appended verbatim.
 */
const PiConfig = z.object({
  command: z.string().min(1).default("pi"),
  extraArgs: z.array(z.string()).default([]),
});
type PiConfig = z.infer<typeof PiConfig>;

interface SessionMeta {
  healthy: boolean;
  busy: boolean;
}

export function createAdapter(config?: Readonly<Record<string, unknown>>): Adapter {
  const cfg: PiConfig = PiConfig.parse(config ?? {});
  const procs = new Map<string, WorkerProcess>();
  const sessions = new Map<string, SessionMeta>();
  const sessionModels = new Map<string, string | undefined>();

  function buildArgs(prompt: string, model: string | undefined, first: boolean): string[] {
    // pi exec hangs when stdin is a TTY (hub workers run under tmux) — route
    // through sh with stdin redirected from /dev/null, stdout stays piped.
    const piArgs = [cfg.command, "exec"];
    if (!first) piArgs.push("--continue");
    if (model) piArgs.push("--model", model);
    piArgs.push(...cfg.extraArgs, JSON.stringify(prompt));
    const cmdline = piArgs.map((a) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(a) ? a : "'" + a.replace(/'/g, "'\\''") + "'")).join(" ");
    return ["sh", "-c", cmdline + " </dev/null"];
  }

  function attach(ctx: AdapterContext, proc: WorkerProcess, meta: SessionMeta) {
    let stdout = "";
    procs.set(ctx.sessionId, proc);
    proc.onStdout((chunk: string) => {
      stdout += chunk;
    });
    proc.onStderr((chunk: string) => {
      ctx.log("warn", "pi stderr", { chunk: chunk.slice(0, 500) });
    });
    proc.onExit((code: number | null) => {
      meta.busy = false;
      const text = stdout.trim();
      if (text) {
        ctx.emit({ type: "assistant", summary: text.slice(0, 200), payload: { text } });
      }
      ctx.emit({ type: "system", summary: "pi: turn finished", payload: { kind: "pi.turn_end", code: code ?? 0 } });
      if (code !== 0 && code !== null) meta.healthy = false;
      if (procs.get(ctx.sessionId) === proc) procs.delete(ctx.sessionId);
    });
  }

  const adapter: Adapter = {
    id: "pi",
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
        features: {
          followUp: true,
          interrupt: true,
          toolGate: "bypass",
          questions: false,
          modelChoice: "start",
          modelSwitch: false,
          permissionModes: [],
          skills: false,
          agents: false,
          images: false,
          files: false,
          contextFork: false,
        },
      };
    },

    async start(spec: SessionSpec, ctx: AdapterContext): Promise<SessionHandle> {
      const meta: SessionMeta = { healthy: true, busy: true };
      sessions.set(ctx.sessionId, meta);
      sessionModels.set(ctx.sessionId, spec.model);
      const proc = await ctx.spawnWorker(
        buildArgs(spec.prompt ?? "(Session startet — bitte bestätigen mit OK)", spec.model, true),
        spec.env ? { env: spec.env } : undefined,
      );
      attach(ctx, proc, meta);
      return {
        sessionId: ctx.sessionId,
        ...(proc.pid !== undefined ? { pid: proc.pid } : {}),
      };
    },

    async steer(handle: SessionHandle, input: SteerInput, ctx: AdapterContext): Promise<Ack> {
      switch (input.kind) {
        case "prompt": {
          const meta = sessions.get(handle.sessionId);
          if (meta) meta.busy = true;
          const proc = await ctx.spawnWorker(
            buildArgs(input.text, sessionModels.get(handle.sessionId), false),
            undefined,
          );
          attach(ctx, proc, meta ?? { healthy: true, busy: true });
          return { ok: true };
        }
        case "stop":
          await adapter.stop(handle, ctx);
          return { ok: true };
        case "park": {
          await procs.get(handle.sessionId)?.kill("SIGTERM");
          return { ok: true };
        }
        case "configure":
          return { ok: false, detail: "pi: Modus und Modell lassen sich in dieser Session nicht wechseln" };
        case "resume":
          return { ok: false, detail: "pi: resume needs a prompt — steer with kind: 'prompt' instead" };
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
