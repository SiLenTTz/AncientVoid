import type { FastifyInstance } from "fastify";
import type { RouteContext } from "../../route-context.ts";

/** Cross-session notifications (ADR-0015). */
export function registerNotificationsRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps } = ctx;

  // ADR-0015: cross-session notifications; `after` for polling.
  app.get("/api/notifications", async (req) => {
    const q = req.query as { after?: string; limit?: string };
    const after = Number(q.after ?? 0);
    const limit = Number(q.limit ?? 50);
    return deps.sessions.notifications(Number.isFinite(after) ? after : 0, Number.isFinite(limit) ? limit : 50);
  });
}
