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
} from "@uacc/contracts";
import { EVENT_TYPES, type EventType } from "@uacc/contracts";

/**
 * Dummy adapter — the reference implementation of the Adapter contract.
 *
 * It generates synthetic NormalizedEvents at a configurable rate, cycling
 * through all event types, with optional giant payloads (K5 blob tests).
 * Used for: hub development without real CLIs, load tests (K8), crash
 * recovery drills (K7), and as a template for real adapters.
 *
 * Config (via hub.config.json → adapters[].config):
 *   eventsPerSecond: 1–100 (default 5)
 *   cycleTypes: emit all event types in rotation (default true)
 *   giantEvery: emit a giant payload every N events (0 = never, default 0)
 *   giantBytes: size of giant payloads (default 1 MB)
 *   autoStopAfterEvents: stop generation after N events (0 = endless)
 *   failStart: throw on start (error-path testing)
 *   resumeOnRecover: restart generation after hub crash (default true)
 */

const DummyConfig = z.object({
  eventsPerSecond: z.number().int().min(1).max(100).default(5),
  cycleTypes: z.boolean().default(true),
  giantEvery: z.number().int().min(0).default(0),
  giantBytes: z.number().int().min(4096).default(1024 * 1024),
  autoStopAfterEvents: z.number().int().min(0).default(0),
  failStart: z.boolean().default(false),
  resumeOnRecover: z.boolean().default(true),
});
type DummyConfig = z.infer<typeof DummyConfig>;

const TYPE_CYCLE: EventType[] = [
  "user",
  "thinking",
  "assistant",
  "tool_use",
  "tool_result",
  "assistant",
  "system",
];

interface DummyHandle extends SessionHandle {
  meta: { running: boolean; emitted: number; timer?: NodeJS.Timeout };
}

export function createAdapter(config?: Readonly<Record<string, unknown>>): Adapter {
  const cfg = DummyConfig.parse(config ?? {});
  const handles = new Map<string, DummyHandle>();

  const adapter: Adapter = {
    id: "dummy",
    version: "0.1.0",

    capabilities(): AdapterCapabilities {
      // ADR-0042 (EPIC-P25): one sample command so contract tests and E2E
      // can exercise the whole pipe — a test double, not a claim about a CLI.
      return { reasoning: true, tools: true, cost: false, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none", commands: [{ name: "/compact", description: "Kontext komprimieren (Testdouble)", scope: "both" }], features: { followUp: true, interrupt: true, toolGate: "none", questions: false, modelChoice: "none", modelSwitch: false, permissionModes: [], skills: false, agents: false, images: false, files: false, contextFork: false } };
    },

    async start(_spec: SessionSpec, ctx: AdapterContext): Promise<SessionHandle> {
      if (cfg.failStart) throw new Error("dummy adapter: configured failStart=true");
      const handle: DummyHandle = {
        sessionId: ctx.sessionId,
        meta: { running: true, emitted: 0 },
      };
      handles.set(handle.sessionId, handle);
      startGenerating(handle, ctx);
      return handle;
    },

    async steer(handle: SessionHandle, input: SteerInput, ctx: AdapterContext): Promise<Ack> {
      const h = handles.get(handle.sessionId);
      if (!h) return { ok: false, detail: "unknown handle" };
      switch (input.kind) {
        case "prompt":
          // The hub records the user's prompt itself; this only shows what
          // reached the adapter (including a skill chain in front).
          ctx.emit({
            type: "system",
            summary: `steer: ${input.text.slice(0, 120)}`,
            payload: { kind: "dummy.prompt", text: input.text },
          });
          return { ok: true };
        case "configure":
          return { ok: false, detail: "dummy: Modus und Modell lassen sich in dieser Session nicht wechseln" };
        case "resume":
          if (!h.meta.running) {
            h.meta.running = true;
            startGenerating(h, ctx);
          }
          return { ok: true };
        case "park":
          stopGenerating(h);
          return { ok: true };
        case "stop":
          stopGenerating(h);
          return { ok: true };
      }
    },

    async status(handle: SessionHandle): Promise<HealthReport> {
      const h = handles.get(handle.sessionId);
      if (!h) return { state: "down", detail: "no live handle" };
      return {
        state: h.meta.running ? "healthy" : "degraded",
        lastSeen: new Date().toISOString(),
      };
    },

    async stop(handle: SessionHandle): Promise<void> {
      const h = handles.get(handle.sessionId);
      if (h) stopGenerating(h);
      handles.delete(handle.sessionId);
    },

    async recover(sessionId: string, _lastSeq: number, ctx: AdapterContext): Promise<SessionHandle | null> {
      if (!cfg.resumeOnRecover) return null;
      const handle: DummyHandle = {
        sessionId,
        meta: { running: true, emitted: 0 },
      };
      handles.set(sessionId, handle);
      ctx.emit({ type: "system", summary: "dummy: generation restarted after recovery", payload: {} });
      startGenerating(handle, ctx);
      return handle;
    },
  };

  function startGenerating(handle: DummyHandle, ctx: AdapterContext): void {
    const interval = Math.max(10, Math.floor(1000 / cfg.eventsPerSecond));
    const timer = setInterval(() => {
      if (!handle.meta.running || ctx.signal.aborted) {
        stopGenerating(handle);
        return;
      }
      const n = ++handle.meta.emitted;
      const type = cfg.cycleTypes
        ? TYPE_CYCLE[(n - 1) % TYPE_CYCLE.length]!
        : "assistant";
      if (cfg.giantEvery > 0 && n % cfg.giantEvery === 0) {
        const data = "x".repeat(cfg.giantBytes);
        void ctx.blob(data).then((blob) => {
          ctx.emit({
            type: "tool_result",
            summary: `giant output ${blob.bytes} B → blob`,
            payload: { note: "offloaded via ctx.blob", bytes: blob.bytes },
            blobRef: `sha256:${blob.hash}`,
          });
        });
        return;
      }
      const payload: Record<string, unknown> = { n, type, adapter: "dummy" };
      // TYPE_CYCLE always places tool_use immediately before tool_result
      // (indices 3, 4) — correlate them the same way adapter-claude and
      // adapter-codex do (payload.id / payload.toolUseId), so the dummy
      // adapter stays a faithful template for T1.8's tool-call chip +
      // anchor-nav UI, not just its own K5/K7/K8 test fixture.
      if (type === "tool_use") payload.id = `dummy-tool-${n}`;
      if (type === "tool_result") payload.toolUseId = `dummy-tool-${n - 1}`;
      ctx.emit({
        type,
        summary: `dummy ${type} #${n}`,
        payload,
        tokensEst: 10 + (n % 40),
        tokensSource: "estimated",
      });
      if (cfg.autoStopAfterEvents > 0 && n >= cfg.autoStopAfterEvents) {
        stopGenerating(handle);
        ctx.emit({
          type: "system",
          summary: "dummy: auto-stop reached",
          payload: { emitted: n },
        });
      }
    }, interval);
    timer.unref();
    handle.meta.timer = timer;
  }

  function stopGenerating(handle: DummyHandle): void {
    handle.meta.running = false;
    if (handle.meta.timer) clearInterval(handle.meta.timer);
    delete handle.meta.timer;
  }

  return adapter;
}

export const DUMMY_EVENT_TYPES = EVENT_TYPES;
