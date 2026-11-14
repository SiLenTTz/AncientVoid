import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { TeamStart } from "@ancientvoid/contracts";
import { TeamError } from "@ancientvoid/core";
import { createHubTeam } from "./index.ts";
import type { RouteContext } from "../../route-context.ts";

/**
 * EPIC-P40 (ADR-0064), EPIC-P60 (ADR-0077): Team-Routen. Policy
 * (platform/policy.ts) mappt Schreiben auf `team.manage` (Mensch) und Lesen
 * auf `team.read` — Agenten dürfen zuschauen, aber keine Teams steuern
 * (AC-P40-3/4). Der Session-Port verdrahtet den echten SessionManager;
 * Blobs liegen im EventStore (K5/K7).
 */
export function registerTeamRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps } = ctx;

  const runtime = deps.team ?? createHubTeam(deps);
  const { store, coordinator } = runtime;
  void runtime.ready.catch(err => app.log.error({ err }, "team recovery failed"));
  app.addHook("onReady", async () => { await runtime.ready; });
  app.addHook("onClose", async () => coordinator.stopLoop());

  const fail = (reply: FastifyReply, err: unknown): FastifyReply => {
    if (err instanceof TeamError) {
      const status = err.code === "not_found" ? 404 : err.code === "stale_delivery" || err.code === "gate_closed" ? 409 : 422;
      return reply.code(status).send({ error: err.message, code: err.code });
    }
    return reply.code(500).send({ error: err instanceof Error ? err.message : "Team-Fehler" });
  };

  app.get("/api/teams", async () => store.list());

  app.post("/api/teams", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = TeamStart.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Team-Start ungültig", issues: body.error.issues.slice(0, 5) });
    // Adapter-Rahmen und Tiefe 1 erzwingt validatePlan im Coordinator; Loop-Adapter
    // zusätzlich hier abweisen (ADR-0064 §1: keine zweite Steuerungsebene über Teams).
    if (body.data.frame.adapters.some((a) => a.startsWith("loop:"))) {
      return reply.code(422).send({ error: "Loop-Adapter sind als Team-Worker nicht freigegeben.", code: "adapter_not_allowed" });
    }
    try {
      const team = await coordinator.start(body.data, req.policy?.actor ?? "human");
      return reply.code(201).send(team);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get("/api/teams/:id", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const team = store.get(id);
    if (!team) return reply.code(404).send({ error: "Team unbekannt." });
    return team;
  });

  app.post("/api/teams/:id/answer", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ gateId: z.string().min(1), label: z.string().min(1) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "gateId und label erforderlich." });
    try {
      const team = await coordinator.answer(id, body.data.gateId, body.data.label, req.policy?.actor ?? "human");
      if (!team) return reply.code(404).send({ error: "Team unbekannt." });
      return team;
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post("/api/teams/:id/cancel", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ reason: z.string().max(500).default("") }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "reason ungültig." });
    const team = await coordinator.cancel(id, body.data.reason || "Über die Oberfläche gestoppt.", req.policy?.actor ?? "human");
    if (!team) return reply.code(404).send({ error: "Team unbekannt." });
    return team;
  });
}
