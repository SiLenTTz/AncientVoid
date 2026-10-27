import type { FastifyInstance } from "fastify";
import type { RouteContext } from "../../route-context.ts";

/** EPIC-P21 T21.3: measured turns and the estimate for a running one. */
export function registerRunsRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps } = ctx;

  app.get("/api/sessions/:id/turns", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deps.sessions.get(id)) return reply.code(404).send({ error: "unknown session" });
    return { turns: deps.sessions.turnMetrics(id) };
  });

  app.get("/api/sessions/:id/estimate", async (req, reply) => {
    const { id } = req.params as { id: string };
    const estimate = deps.sessions.runEstimate(id);
    return estimate ?? reply.code(404).send({ error: "unknown session" });
  });

  app.get("/api/metrics/turns", async () => ({ groups: deps.sessions.turnMetricsSummary() }));
}
