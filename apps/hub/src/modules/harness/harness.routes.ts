import type { FastifyInstance } from "fastify";
import { probeHarnesses, HARNESS_CATALOG, spawnProbeRunner } from "@uacc/core";
import type { ModelOption } from "@uacc/contracts";
import { enhanceFlavorFor } from "../prompts/enhance.ts";
import type { RouteContext } from "../../route-context.ts";

/** Adapters, model catalog, quota and harness inventory (ADR-0004, ADR-0012, ADR-0018). */
export function registerHarnessRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps } = ctx;

  app.get("/api/adapters", async () =>
    deps.registry.list().map((a) => ({
      id: a.id,
      version: a.adapter.version,
      capabilities: a.capabilities,
      // BUG-0061: server-side truth (registration, not id guessing) so the
      // PWA can honestly show/hide "Verbessern" — also for dsh ACP
      // registrations under free-form ids like "deepseek".
      enhance: enhanceFlavorFor(a.id, a.module, a.config as Record<string, unknown> | undefined) !== null,
    })),
  );


  // ADR-0018: an adapter's model catalog. `models: null` means it has
  // none (the PWA then offers free text). Cached, a listing can take seconds.
  // `defaultModel` is the registration's configured model — what the
  // harness runs when a session names none.
  const modelCache = new Map<string, { at: number; models: ModelOption[] | null; defaultModel: string | null }>();
  app.get("/api/adapters/:id/models", async (req, reply) => {
    const { id } = req.params as { id: string };
    const registered = deps.registry.get(id);
    if (!registered) return reply.code(404).send({ error: "unknown adapter" });
    const defaultModel = typeof registered.config?.model === "string" ? registered.config.model : null;
    const cached = modelCache.get(id);
    if (cached && Date.now() - cached.at < 10 * 60_000) return { adapterId: id, models: cached.models, defaultModel };
    let models: ModelOption[] | null;
    try {
      models = registered.adapter.models ? await registered.adapter.models() : null;
    } catch (err) {
      req.log.warn({ adapter: id, err: err instanceof Error ? err.message : String(err) }, "model catalog failed");
      return { adapterId: id, models: null, defaultModel };
    }
    modelCache.set(id, { at: Date.now(), models, defaultModel });
    return { adapterId: id, models, defaultModel };
  });


  app.get("/api/adapters/:id/usage", async (req, reply) => {
    // ADR-0004: account-level usage/quota, not session-scoped. `usage`
    // reflects capabilities().usage — false means "verified absent for
    // this adapter" (e.g. codex), never guessed as 0%. `snapshot` is null
    // whenever this adapter hasn't emitted one yet, distinct from "0%
    // used": a session that only just started may not have seen one.
    const { id } = req.params as { id: string };
    const registered = deps.registry.list().find((a) => a.id === id);
    if (!registered) return reply.code(404).send({ error: "unknown adapter" });
    const snapshot = deps.sessions.getAdapterUsage(id);
    return {
      adapterId: id,
      supported: registered.capabilities.usage,
      quota: snapshot?.quota ?? null,
      observedAt: snapshot?.observedAt ?? null,
    };
  });


  app.get("/api/inventory", async () => {
    const items = await probeHarnesses(HARNESS_CATALOG, deps.probeRunner ?? spawnProbeRunner());
    return { items };
  });
}
