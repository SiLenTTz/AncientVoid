import type { FastifyInstance } from "fastify";
import type { AiMetricsReport } from "@ancientvoid/contracts";
import type { RouteContext } from "../../route-context.ts";

/**
 * EPIC-P59 (ADR-0078): Les-API für die Metrik-Seite — REST, keine
 * EventBus-Payloads (K5). Ohne konfigurierten Sampler antwortet der Endpunkt
 * mit leerer Quelle-Liste statt stiller Nullen (ADR-0078).
 */
export function registerAiMetricsRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get("/api/aimetrics", async (): Promise<AiMetricsReport> => {
    const sampler = ctx.deps.aimetrics;
    if (!sampler) {
      return {
        generatedAt: new Date().toISOString(),
        intervalSec: 10,
        windowSec: 900,
        self: { hostLabel: ctx.hostLabel ?? ctx.hostId },
        sources: [],
      };
    }
    return sampler.report();
  });
}
