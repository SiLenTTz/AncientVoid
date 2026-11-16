import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolve } from "node:path";
import { z } from "zod";
import { BUILTIN_ACTIONS, detectedActions, isProjectPathAllowed } from "@ancientvoid/core";
import { AutomationDefinition, AutomationEnableBody, AutomationExecuteBody, AutomationResolveBody, type ActionDefinition } from "@ancientvoid/contracts";
import type { RouteContext } from "../../route-context.ts";
import { resolveAutomationAction } from "./automations-service.ts";

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
  const { deps, projectRoots } = ctx;
  const off = async (_req: FastifyRequest, reply: FastifyReply) => reply.code(501).send({ error: "Automations sind auf diesem Hub nicht eingerichtet." });
  if (!deps.automations) {
    // Ohne Dienst bleiben die Routen sichtbar, aber leer — 501, kein Absturz (Muster wie approvals/webauthn).
    app.get("/api/automations/actions", off);
    app.get("/api/automations", off);
    app.get("/api/automations/:id/history", off);
    app.get("/api/automations/:id/template", off);
    app.post("/api/automations", off);
    app.patch("/api/automations/:id", off);
    app.post("/api/automations/:id/enable", off);
    app.post("/api/automations/:id/run-now", off);
    app.post("/api/automations/:id/resolve", off);
    return;
  }
  const service = deps.automations;

  app.get("/api/automations", async () => ({ automations: service.list() }));

  // ADR-0080: registrierte Aktionen eines Projekts — Quelle für Skript-Ziele im Formular (projectRoots-Prüfung wie git-graph).
  app.get("/api/automations/actions", async (req, reply) => {
    const { project } = req.query as { project?: string };
    if (!project) return reply.code(400).send({ error: "project query param required" });
    if (!(await isProjectPathAllowed(project, projectRoots))) {
      return reply.code(422).send({ error: "project path is outside the configured projectRoots" });
    }
    const seen = new Set<string>();
    const actions: ActionDefinition[] = [...(deps.actions ?? []), ...BUILTIN_ACTIONS, ...(await detectedActions(resolve(project)))]
      .filter((a) => !seen.has(a.id) && seen.add(a.id));
    return { actions };
  });

  app.get("/api/automations/:id/history", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!service.list().some((a) => a.definition.id === id)) return reply.code(404).send({ error: "unbekannte automation" });
    return { automationId: id, history: service.history(id) };
  });

  app.get("/api/automations/:id/template", async (req, reply) => {
    const { id } = req.params as { id: string };
    const template = service.template(id);
    return template ?? reply.code(404).send({ error: "Keine eingefrorene Run-Vorlage vorhanden" });
  });

  app.post("/api/automations", async (req, reply) => {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    // ADR-0080: unbekannte Skript-Aktionen scheitern laut beim Anlegen, nicht erst beim Lauf.
    if (parsed.data.definition.target.kind === "script" && !(await resolveAutomationAction(deps.actions, resolve(parsed.data.definition.target.project), parsed.data.definition.target.actionId))) {
      return reply.code(400).send({ error: `Unbekannte Skript-Aktion ${parsed.data.definition.target.actionId}` });
    }
    try {
      return reply.code(201).send(service.create(await service.prepare(parsed.data.definition), parsed.data.promptText));
    } catch (err) {
      return reply.code(err instanceof Error && /Generation veraltet/.test(err.message) ? 409 : 400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.patch("/api/automations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    if (parsed.data.definition.target.kind === "script" && !(await resolveAutomationAction(deps.actions, resolve(parsed.data.definition.target.project), parsed.data.definition.target.actionId))) {
      return reply.code(400).send({ error: `Unbekannte Skript-Aktion ${parsed.data.definition.target.actionId}` });
    }
    try {
      const stored = service.update(id, await service.prepare(parsed.data.definition), parsed.data.promptText);
      if (!stored) return reply.code(404).send({ error: "unbekannte automation" });
      return stored;
    } catch (err) {
      return reply.code(err instanceof Error && /Generation veraltet/.test(err.message) ? 409 : 400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/automations/:id/enable", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = AutomationEnableBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    try {
      const stored = service.setEnabled(id, parsed.data.enabled, parsed.data.generation);
      if (!stored) return reply.code(404).send({ error: "unbekannte automation" });
      return stored;
    } catch (err) { return reply.code(409).send({ error: String(err) }); }
  });

  app.post("/api/automations/:id/run-now", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!service.list().some(info => info.definition.id === id)) return reply.code(404).send({ error: "unbekannte automation" });
    const parsed = AutomationExecuteBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Run-now braucht die geprüfte Generation" });
    try {
      const claim = service.requestRunNow(id, parsed.data.generation);
      return reply.code(202).send(claim);
    } catch (err) { return reply.code(409).send({ error: String(err) }); }
  });

  // ADR-0072: einen unklaren Start ohne Referenz menschlich aufgeben.
  app.post("/api/automations/:id/resolve", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = AutomationResolveBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Aufgeben braucht den Claim und eine Notiz" });
    try {
      const claim = service.resolveUnknown(id, parsed.data.claimKey, parsed.data.note);
      return claim ?? reply.code(404).send({ error: "unbekannter Claim" });
    } catch (err) { return reply.code(409).send({ error: err instanceof Error ? err.message : String(err) }); }
  });
}
