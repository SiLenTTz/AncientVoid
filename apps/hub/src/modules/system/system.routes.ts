import type { FastifyInstance } from "fastify";
import { collectHealth } from "@ancientvoid/core";
import { FLEET_PROTOCOL_VERSION } from "@ancientvoid/contracts";
import type { FleetHello } from "@ancientvoid/contracts";
import type { RouteContext } from "../../route-context.ts";
import { resolve } from "node:path";
import { deploymentIdentity } from "./deployment.ts";

/** Reported to other hubs in /api/fleet/hello. */
const HUB_VERSION = "0.1.0";

/** Health, readiness, metrics and the fleet hello (ADR-0010, ADR-0017). */
export function registerSystemRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps, hostId, hostLabel, startedAt } = ctx;
  const deployment = deploymentIdentity(resolve(import.meta.dirname, "../../../../.."), deps.pwaDir);

  app.get("/api/fleet/hello", async (): Promise<FleetHello> => ({
    hostId,
    ...(hostLabel ? { label: hostLabel } : {}),
    protocolVersion: FLEET_PROTOCOL_VERSION,
    hubVersion: HUB_VERSION,
    serverTime: new Date().toISOString(),
  }));


  app.get("/api/health", async () =>
    ({ ...await collectHealth({
      startedAt,
      sessions: deps.sessions,
      registry: deps.registry,
      ...(deps.store ? { store: deps.store } : {}),
    }), deployment: deployment() }),
  );


  app.get("/api/ready", async (_req, reply) => {
    const report = await collectHealth({
      startedAt,
      sessions: deps.sessions,
      registry: deps.registry,
      ...(deps.store ? { store: deps.store } : {}),
    });
    const body = { ...report, deployment: deployment() };
    if (!report.ok) return reply.code(503).send(body);
    return body;
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
