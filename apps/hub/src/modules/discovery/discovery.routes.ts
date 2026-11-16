import type { FastifyInstance } from "fastify";
import type { RouteContext } from "../../route-context.ts";

/** Sessions this hub did not start (ADR-0011, ADR-0012). */
export function registerDiscoveryRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps } = ctx;

  app.get("/api/discovery", async (req) => {
    const q = req.query as { cursor?: string; limit?: string; q?: string; adapter?: string };
    const cursor = Number(q.cursor ?? 0);
    const limit = Number(q.limit ?? 50);
    return deps.sessions.discover(deps.discoverySources ?? [], Number.isFinite(cursor) ? cursor : 0, Number.isFinite(limit) ? limit : 50, {
      ...(q.q ? { q: q.q.slice(0, 200) } : {}),
      ...(q.adapter ? { adapter: q.adapter } : {}),
    });
  });
}
