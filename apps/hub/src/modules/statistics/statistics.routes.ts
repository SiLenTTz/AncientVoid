import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RouteContext } from "../../route-context.ts";

/**
 * EPIC-P56 T56.3: Les-API der Statistik-Seite — nur Aggregate aus dem
 * Rollup-Cache, nie Journals (ADR-0079). Der Schnitt ist Query, die Antwort
 * validiert der Contract `StatisticsReport` (Schema-Tests in contracts).
 */
const Query = z.object({
  project: z.string().min(1).optional(),
  host: z.string().min(1).optional(),
  harness: z.string().min(1).optional(),
  since: z.iso.datetime().optional(),
  until: z.iso.datetime().optional(),
}).strict();

export function registerStatisticsRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get("/api/statistics", async (req, reply) => {
    const service = ctx.deps.statistics;
    if (!service) return reply.code(501).send({ error: "Statistiken nicht eingerichtet — dieser Hub führt keinen Rollup." });
    const parsed = Query.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Statistik-Schnitt ungültig", issues: parsed.error.issues.slice(0, 5) });
    }
    const { project, host, harness, since, until } = parsed.data;
    return service.report({
      ...(project !== undefined ? { project } : {}),
      ...(host !== undefined ? { hostId: host } : {}),
      ...(harness !== undefined ? { harness } : {}),
      ...(since !== undefined ? { since } : {}),
      ...(until !== undefined ? { until } : {}),
    });
  });
}
