import type { FastifyInstance } from "fastify";
import { collectHealth } from "@ancientvoid/core";
import { FLEET_PROTOCOL_VERSION } from "@ancientvoid/contracts";
import type { FleetHello } from "@ancientvoid/contracts";
import type { RouteContext } from "../../route-context.ts";

/** Reported to other hubs in /api/fleet/hello. */
const HUB_VERSION = "0.1.0";

/** Health, readiness, metrics and the fleet hello (ADR-0010, ADR-0017). */
export function registerSystemRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps, hostId, hostLabel, startedAt } = ctx;

  app.get("/api/fleet/hello", async (): Promise<FleetHello> => ({
    hostId,
    ...(hostLabel ? { label: hostLabel } : {}),
    protocolVersion: FLEET_PROTOCOL_VERSION,
    hubVersion: HUB_VERSION,
    serverTime: new Date().toISOString(),
  }));


  app.get("/api/health", async () =>
    collectHealth({
      startedAt,
      sessions: deps.sessions,
      registry: deps.registry,
      ...(deps.store ? { store: deps.store } : {}),
    }),
  );


  app.get("/api/ready", async (_req, reply) => {
    const report = await collectHealth({
      startedAt,
      sessions: deps.sessions,
      registry: deps.registry,
      ...(deps.store ? { store: deps.store } : {}),
    });
    if (!report.ok) return reply.code(503).send(report);
    return report;
  });


  app.get("/api/metrics", async () => {
    const snapshot = deps.metrics?.snapshot() ?? { ts: new Date().toISOString(), counters: {}, gauges: {} };
    const counts = deps.sessions.sessionCounts();
    return {
      ...snapshot,
      gauges: {
        ...snapshot.gauges,
        sessions_live: counts.live,
        sessions_total: counts.total,
      },
    };
  });
}
