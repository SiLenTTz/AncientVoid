import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RouteContext } from "../../route-context.ts";

const HandoverBody = z.object({
  adapter: z.string().min(1),
  model: z.string().min(1).optional(),
  prompt: z.string().min(1),
});

/** EPIC-P21 T21.2 (ADR-0039): hand a session over to another provider, harness or model. */
export function registerHandoverRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps } = ctx;

  app.get("/api/sessions/:id/handover", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deps.sessions.get(id)) return reply.code(404).send({ error: "unknown session" });
    return deps.sessions.handoverDraft(id);
  });

  app.post("/api/sessions/:id/handover", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deps.sessions.get(id)) return reply.code(404).send({ error: "unknown session" });
    // An agent never moves work between providers on its own — that is a person's call.
    if (req.policy?.decision === "approve") return reply.code(403).send({ error: "Übergabe braucht einen Menschen, nicht einen Agenten" });
    const parsed = HandoverBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid handover", issues: parsed.error.issues });
    try {
      const record = await deps.sessions.handover(id, parsed.data, ctx.callerLabel(req) ?? undefined);
      return reply.code(201).send({ ...record, hostId: ctx.hostId });
    } catch (err) {
      return reply.code(422).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
