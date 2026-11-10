import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { AutomationDefinition } from "@ancientvoid/contracts";
import type { RouteContext } from "../../route-context.ts";

/**
 * EPIC-P41 T41.4 (ADR-0064): Liste/Editor/Run-now/Disable — die Verwaltung
 * entscheidet die Policy-Tabelle (Mensch und Flotte; Agenten: deny). Neue
 * Definitionen beginnen deaktiviert; wesentliche Änderung invalidiert die alte
 * Freigabe (das Update liefert sie deaktiviert zurück). Run-Ziele (P40) sind in
 * diesem Build noch nicht dispatchbar — Anlage failt laut, nicht still.
 */

const CreateBody = z.object({
  definition: AutomationDefinition,
  promptText: z.string().min(1).max(200_000).optional(),
});

export function registerAutomationsRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps } = ctx;
  const off = async (_req: FastifyRequest, reply: FastifyReply) => reply.code(501).send({ error: "Automations sind auf diesem Hub nicht eingerichtet." });
  if (!deps.automations) {
    // Ohne Dienst bleiben die Routen sichtbar, aber leer — 501, kein Absturz (Muster wie approvals/webauthn).
    app.get("/api/automations", off);
    app.get("/api/automations/:id/history", off);
    app.post("/api/automations", off);
    app.patch("/api/automations/:id", off);
    app.post("/api/automations/:id/enable", off);
    app.post("/api/automations/:id/run-now", off);
    return;
  }
  const service = deps.automations;

  app.get("/api/automations", async () => ({ automations: service.list() }));

  app.get("/api/automations/:id/history", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!service.list().some((a) => a.definition.id === id)) return reply.code(404).send({ error: "unbekannte automation" });
    return { automationId: id, history: service.history(id) };
  });

  app.post("/api/automations", async (req, reply) => {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    if (parsed.data.definition.target.kind === "run") return reply.code(501).send({ error: "Run-Vorlagen (P40) sind in diesem Build noch nicht dispatchbar." });
    try {
      return reply.code(201).send(service.create(parsed.data.definition, parsed.data.promptText));
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.patch("/api/automations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    try {
      const stored = service.update(id, parsed.data.definition, parsed.data.promptText);
      if (!stored) return reply.code(404).send({ error: "unbekannte automation" });
      return stored;
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/automations/:id/enable", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = z.object({ enabled: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    const stored = service.setEnabled(id, parsed.data.enabled);
    if (!stored) return reply.code(404).send({ error: "unbekannte automation" });
    return stored;
  });

  app.post("/api/automations/:id/run-now", async (req, reply) => {
    const { id } = req.params as { id: string };
    const claim = await service.runNow(id);
    if (!claim) return reply.code(404).send({ error: "unbekannte automation" });
    return reply.code(202).send(claim);
  });
}
