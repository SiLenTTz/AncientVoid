import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { OrchestrationRunStart } from "@ancientvoid/contracts";
import { OrchestrationError } from "@ancientvoid/core";
import { createHubOrchestration } from "./index.ts";
import type { RouteContext } from "../../route-context.ts";

/**
 * EPIC-P40 (ADR-0064): Orchestrierungs-Routen. Policy (platform/policy.ts) mappt
 * Schreiben auf `orchestration.manage` (Mensch) und Lesen auf `orchestration.read` —
 * Agenten dürfen zuschauen, aber keine Runs steuern (AC-P40-3/4). Der Session-Port
 * verdrahtet den echten SessionManager; Blobs liegen im EventStore (K5/K7).
 */
export function registerOrchestrationRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps } = ctx;

  const runtime = deps.orchestration ?? createHubOrchestration(deps);
  const { store, orchestrator } = runtime;
  void runtime.ready.catch(err => app.log.error({ err }, "orchestration recovery failed"));
  app.addHook("onReady", async () => { await runtime.ready; });
  app.addHook("onClose", async () => orchestrator.stopLoop());

  const fail = (reply: FastifyReply, err: unknown): FastifyReply => {
    if (err instanceof OrchestrationError) {
      const status = err.code === "not_found" ? 404 : err.code === "stale_delivery" || err.code === "gate_closed" ? 409 : 422;
      return reply.code(status).send({ error: err.message, code: err.code });
    }
    return reply.code(500).send({ error: err instanceof Error ? err.message : "Orchestrierungsfehler" });
  };

  app.get("/api/orchestration/runs", async () => store.list());

  app.post("/api/orchestration/runs", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = OrchestrationRunStart.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Run-Start ungültig", issues: body.error.issues.slice(0, 5) });
    // Adapter-Rahmen und Tiefe 1 erzwingt validatePlan im Coordinator; Loop-Adapter
    // zusätzlich hier abweisen (ADR-0064 §1: keine zweite Steuerungsebene über Runs).
    if (body.data.frame.adapters.some((a) => a.startsWith("loop:"))) {
      return reply.code(422).send({ error: "Loop-Adapter sind als Orchestrierungs-Worker nicht freigegeben.", code: "adapter_not_allowed" });
    }
    try {
      const run = await orchestrator.start(body.data, req.policy?.actor ?? "human");
      return reply.code(201).send(run);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get("/api/orchestration/runs/:id", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const run = store.get(id);
    if (!run) return reply.code(404).send({ error: "Run unbekannt." });
    return run;
  });

  app.post("/api/orchestration/runs/:id/answer", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ gateId: z.string().min(1), label: z.string().min(1) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "gateId und label erforderlich." });
    try {
      const run = await orchestrator.answer(id, body.data.gateId, body.data.label, req.policy?.actor ?? "human");
      if (!run) return reply.code(404).send({ error: "Run unbekannt." });
      return run;
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post("/api/orchestration/runs/:id/cancel", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ reason: z.string().max(500).default("") }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "reason ungültig." });
    const run = await orchestrator.cancel(id, body.data.reason || "Über die Oberfläche gestoppt.", req.policy?.actor ?? "human");
    if (!run) return reply.code(404).send({ error: "Run unbekannt." });
    return run;
  });
}
