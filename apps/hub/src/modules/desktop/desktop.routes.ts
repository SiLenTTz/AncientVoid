import type { FastifyInstance, FastifyRequest } from "fastify";
import { COMPANION_TOKEN_PREFIX, CompanionStateReport, DesktopActionRequest, DesktopResult } from "@uacc/contracts";
import type { DesktopService, TokenService } from "@uacc/core";
import { extractToken } from "../../platform/auth.ts";

/**
 * EPIC-P11 (ADR-0031): desktop companion. `/api/desktop/companion/*` is the
 * companion's (its token reaches nothing else, see auth); the rest is the
 * person's: see the PCs and their focus, ask for text to be typed, cancel.
 */
export function registerDesktopRoutes(app: FastifyInstance, deps: { desktop: DesktopService; tokens: TokenService }): void {
  const label = (req: FastifyRequest) => {
    const token = extractToken(req);
    return (token ? deps.tokens.identify(token)?.label : null) ?? "";
  };
  const companionName = (req: FastifyRequest) => {
    const l = label(req);
    return l.startsWith(COMPANION_TOKEN_PREFIX) ? l.slice(COMPANION_TOKEN_PREFIX.length) : null;
  };

  app.addHook("preClose", async () => deps.desktop.close());

  app.post("/api/desktop/companion/state", async (req, reply) => {
    const name = companionName(req);
    if (!name) return reply.code(403).send({ error: "companion token required" });
    const body = CompanionStateReport.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid state" });
    return deps.desktop.report(name, body.data);
  });

  app.get("/api/desktop/companion/next", async (req, reply) => {
    const name = companionName(req);
    if (!name) return reply.code(403).send({ error: "companion token required" });
    const wait = Math.max(0, Math.min(30_000, Number((req.query as { wait?: string }).wait ?? 25_000) || 0));
    const out = await deps.desktop.next(name, wait);
    return reply.header("cache-control", "no-store").send(out);
  });

  app.post("/api/desktop/companion/actions/:id/result", async (req, reply) => {
    const name = companionName(req);
    if (!name) return reply.code(403).send({ error: "companion token required" });
    const body = DesktopResult.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid result" });
    const a = deps.desktop.result(name, (req.params as { id: string }).id, body.data);
    return a ?? reply.code(404).send({ error: "unknown action" });
  });

  app.get("/api/desktop", async () => ({ companions: deps.desktop.companions(), actions: deps.desktop.list(20) }));

  app.post("/api/desktop/actions", async (req, reply) => {
    const body = DesktopActionRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "ungültiger Auftrag" });
    try {
      return reply.code(201).send(deps.desktop.request(body.data, label(req) || "?"));
    } catch (err) {
      return reply.code((err as { status?: number }).status ?? 400).send({ error: err instanceof Error ? err.message : "abgelehnt" });
    }
  });

  app.get("/api/desktop/actions/:id", async (req, reply) => deps.desktop.get((req.params as { id: string }).id) ?? reply.code(404).send({ error: "unknown action" }));

  app.post("/api/desktop/actions/:id/cancel", async (req, reply) => deps.desktop.cancel((req.params as { id: string }).id) ?? reply.code(404).send({ error: "unknown action" }));
}
