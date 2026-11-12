/**
 * Example: OpenAI-compatible endpoint adapter (own providers / local models).
 *
 * Works with any OpenAI-style /v1/chat/completions endpoint:
 * llama.cpp server, LM Studio, Ollama, vLLM, vLLM-served Qwen finetunes,
 * or cloud providers behind a compatible gateway.
 *
 * Wire it into hub.config.json:
 *
 *   {
 *     "id": "my-endpoint",
 *     "module": "./examples/adapters/openai-compat/adapter.ts",
 *     "config": {
 *       "baseUrl": "http://127.0.0.1:8080/v1",
 *       "model": "qwen2.5-coder:14b",
 *       "apiKeyEnv": "LLAMA_API_KEY"
 *     }
 *   }
 *
 * The ONLY thing an adapter is allowed to touch is @ancientvoid/contracts —
 * everything else the hub provides via AdapterContext.
 */
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
} from "@ancientvoid/contracts";

const EndpointConfig = z.object({
  baseUrl: z.string().url(),
  model: z.string().default("local-model"),
  apiKeyEnv: z.string().default("LOCAL_LLM_API_KEY"),
  temperature: z.number().min(0).max(2).default(0.2),
});
type EndpointConfig = z.infer<typeof EndpointConfig>;

interface EndpointHandle extends SessionHandle {
  meta: { history: { role: "user" | "assistant"; content: string }[] };
}

export function createAdapter(config?: Readonly<Record<string, unknown>>): Adapter {
  const cfg = EndpointConfig.parse(config ?? {});
  const apiKey = process.env[cfg.apiKeyEnv] ?? "";
  const handles = new Map<string, EndpointHandle>();

  /** Fail loud, begrenzt (K5): ein Abbruch durch die Session ist kein Fehler, alles andere ein error-Event. */
  function reportFailure(err: unknown, ctx: AdapterContext): void {
    if (ctx.signal.aborted) {
      ctx.emit({ type: "system", summary: "completion aborted", payload: {} });
      return;
    }
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    ctx.emit({ type: "error", summary: `endpoint call failed: ${message}`, payload: { message } });
  }

  /** Stream one completion, mapping SSE chunks to normalized events. */
  async function runCompletion(handle: EndpointHandle, ctx: AdapterContext): Promise<void> {
    ctx.emit({
      type: "system",
      summary: `querying ${cfg.baseUrl} (${cfg.model})`,
      payload: { baseUrl: cfg.baseUrl, model: cfg.model },
    });
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      signal: ctx.signal,
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: handle.meta.history,
        temperature: cfg.temperature,
        stream: true,
      }),
    });
    if (!res.ok || !res.body) {
      ctx.emit({
        type: "error",
        summary: `endpoint returned ${res.status}`,
        payload: { status: res.status },
      });
      return;
    }
    let assistant = "";
    let reasoning = "";
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of res.body) {
      if (ctx.signal.aborted) return;
      buffer += decoder.decode(chunk as Uint8Array, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        let parsed: {
          choices?: { delta?: { content?: string; reasoning_content?: string } }[];
          error?: { message?: unknown } | string;
        };
        try {
          parsed = JSON.parse(data) as typeof parsed;
        } catch {
          // Die Zeile ist vollständig (am \n getrennt) — unlesbar heißt unbekanntes Format, nicht „unvollständig“.
          ctx.emit({ type: "error", summary: "unlesbare Antwortzeile vom Endpoint", payload: { line: data.slice(0, 200) } });
          continue;
        }
        if (parsed.error !== undefined) {
          const message = String(typeof parsed.error === "string" ? parsed.error : (parsed.error.message ?? "unbekannter Fehler")).slice(0, 300);
          ctx.emit({ type: "error", summary: `endpoint meldet Fehler: ${message}`, payload: { message } });
          continue;
        }
        const delta = parsed.choices?.[0]?.delta;
        if (delta?.reasoning_content) {
          reasoning += delta.reasoning_content;
        }
        if (delta?.content) {
          assistant += delta.content;
          ctx.emit({
            type: "assistant",
            summary: delta.content.slice(0, 120),
            payload: { delta: delta.content },
            tokensEst: Math.ceil(delta.content.length / 4),
          });
        }
      }
    }
    // Reasoning lands fully in a blob; the stream stays small (K5 pattern).
    if (reasoning.length > 0) {
      const blob = await ctx.blob(reasoning);
      ctx.emit({
        type: "thinking",
        summary: `reasoning (${reasoning.length} chars → blob)`,
        payload: { bytes: blob.bytes },
        blobRef: `sha256:${blob.hash}`,
      });
    }
    if (assistant.length > 0) {
      handle.meta.history.push({ role: "assistant", content: assistant });
    }
    ctx.emit({ type: "system", summary: "completion finished", payload: {} });
  }

  return {
    id: "my-endpoint",
    version: "0.1.0",

    capabilities(): AdapterCapabilities {
      return { reasoning: true, tools: false, cost: false, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none", features: { followUp: true, interrupt: false, toolGate: "none", questions: false, modelChoice: "none", skills: false, agents: false, images: false, files: false, contextFork: false, modelSwitch: false, permissionModes: [] } };
    },

    async start(spec: SessionSpec, ctx: AdapterContext): Promise<SessionHandle> {
      const handle: EndpointHandle = {
        sessionId: ctx.sessionId,
        meta: { history: [] },
      };
      handles.set(handle.sessionId, handle);
      if (spec.prompt) {
        handle.meta.history.push({ role: "user", content: spec.prompt });
        void runCompletion(handle, ctx).catch((err: unknown) => reportFailure(err, ctx));
      }
      return handle;
    },

    async steer(handle: SessionHandle, input: SteerInput, ctx: AdapterContext): Promise<Ack> {
      const h = handles.get(handle.sessionId);
      if (!h) return { ok: false, detail: "unknown handle" };
      if (input.kind === "prompt") {
        h.meta.history.push({ role: "user", content: input.text });
        void runCompletion(h, ctx).catch((err: unknown) => reportFailure(err, ctx));
        return { ok: true };
      }
      if (input.kind === "stop") {
        return { ok: true };
      }
      return { ok: true };
    },

    async status(): Promise<HealthReport> {
      return { state: "healthy", detail: cfg.baseUrl };
    },

    async stop(handle: SessionHandle): Promise<void> {
      handles.delete(handle.sessionId);
    },
  };
}
