import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { homedir } from "node:os";
import { join } from "node:path";
import { CustomModelStore, probeHarnesses, HARNESS_CATALOG, spawnProbeRunner, writePiProvider } from "@ancientvoid/core";
import { CustomModelInput, PiProviderInput, isLoopAdapter, type ModelOption } from "@ancientvoid/contracts";
import type { RouteContext } from "../../route-context.ts";

/** Adapters, model catalog, quota and harness inventory (ADR-0004, ADR-0012, ADR-0018). */
export function registerHarnessRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps } = ctx;

  app.get("/api/adapters", async () =>
    // EPIC-P19: Loop-Shims (`loop:<id>`) gehören in die Loop-Auswahl, nicht in die Adapter-Liste.
    deps.registry.list().filter((a) => !isLoopAdapter(a.id)).map((a) => ({
      id: a.id,
      version: a.adapter.version,
      capabilities: a.capabilities,
      // BUG-0061: server-side truth (registration, not id guessing) so the
      // PWA can honestly show/hide "Verbessern" — also for dsh ACP
      // registrations under free-form ids like "deepseek".
      enhance: true, // 2026-10-24: enhancePrompt falls back to opencode for any adapter — button offered everywhere
    })),
  );


  // ADR-0018: an adapter's model catalog. `models: null` means it has
  // none (the PWA then offers free text). Cached, a listing can take seconds.
  // `defaultModel` is the registration's configured model — what the
  // harness runs when a session names none.
  // ADR-0060: eigene Modelle aus dem Hub-Register kommen zum Katalog des Adapters dazu (`customIds`
  // sagt der PWA, welche); nur Adapter mit Modellwahl (`modelChoice: "start"`) bekommen sie angezeigt.
  const custom = new CustomModelStore(deps.settings ?? { get: () => null, set: () => undefined });
  const modelCache = new Map<string, { at: number; models: ModelOption[] | null }>();
  app.get("/api/adapters/:id/models", async (req, reply) => {
    const { id } = req.params as { id: string };
    const registered = deps.registry.get(id);
    if (!registered) return reply.code(404).send({ error: "unknown adapter" });
    const defaultModel = typeof registered.config?.model === "string" ? registered.config.model : null;
    const respond = (catalog: ModelOption[] | null) => {
      const hasChoice = registered.capabilities.features?.modelChoice === "start";
      if (!hasChoice) return { adapterId: id, models: catalog, defaultModel, customIds: [] as string[] };
      const merged = custom.merge(id, catalog);
      return { adapterId: id, models: merged.models.length > 0 ? merged.models : null, defaultModel, customIds: merged.customIds };
    };
    const cached = modelCache.get(id);
    if (cached && Date.now() - cached.at < 10 * 60_000) return respond(cached.models);
    let models: ModelOption[] | null;
    try {
      models = registered.adapter.models ? await registered.adapter.models() : null;
    } catch (err) {
      req.log.warn({ adapter: id, err: err instanceof Error ? err.message : String(err) }, "model catalog failed");
      return respond(null);
    }
    modelCache.set(id, { at: Date.now(), models });
    return respond(models);
  });

  const humanOnly = (req: FastifyRequest, reply: FastifyReply): boolean => {
    if (req.policy?.decision === "approve") {
      void reply.code(403).send({ error: "Modelle und Endpunkte legt ein Mensch an." });
      return false;
    }
    return true;
  };
  app.get("/api/models/custom", async () => ({ items: custom.list() }));
  app.post("/api/models/custom", async (req, reply) => {
    if (!humanOnly(req, reply)) return;
    const parsed = CustomModelInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "ungültige Eingabe" });
    return { ok: true, model: custom.add(parsed.data) };
  });
  app.delete("/api/models/custom", async (req, reply) => {
    if (!humanOnly(req, reply)) return;
    const id = (req.query as { id?: string }).id;
    if (!id || !custom.remove(id)) return reply.code(404).send({ error: "kein solches eigenes Modell" });
    return { ok: true };
  });
  // Provider in pi's models.json (ADR-0060) — pi reloads the file when /model opens. Other harnesses:
  // no verified native format yet, so no route (kein erfundenes Schreiben in fremde Configs).
  app.post("/api/adapters/:id/provider", async (req, reply) => {
    if (!humanOnly(req, reply)) return;
    const { id } = req.params as { id: string };
    const registered = deps.registry.get(id);
    if (!registered) return reply.code(404).send({ error: "unknown adapter" });
    if (registered.adapter.id !== "pi") return reply.code(501).send({ error: "Eigene Endpunkte lassen sich bisher nur für pi eintragen; für die übrigen Harnesses als eigenes Modell oder in deren eigener Config." });
    const body = req.body as { replace?: boolean } & Record<string, unknown>;
    const parsed = PiProviderInput.safeParse(body);
    if (!parsed.success) return reply.code(400).send({ error: `${parsed.error.issues[0]?.path.join(".") ?? ""} ${parsed.error.issues[0]?.message ?? "ungültige Eingabe"}`.trim() });
    const file = join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "models.json");
    const result = await writePiProvider(file, parsed.data, { replace: body.replace === true });
    if (!result.ok) return reply.code(result.status).send({ error: result.detail });
    modelCache.delete(id);
    // The new provider's models are offered right away, also in the hub's own register view.
    for (const m of parsed.data.models) custom.add({ id: `${parsed.data.name}/${m.id}`, ...(m.name ? { label: m.name } : {}), adapters: [id] });
    return { ok: true, created: result.created, backup: result.backup };
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
