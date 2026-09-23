import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RouteContext } from "../../route-context.ts";

/** Device tokens and passkey registration (T2.5). */
export function registerIdentityRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps, callerLabel, webauthnRoutes } = ctx;

  app.get("/api/tokens", async () => deps.tokens.list());


  app.post("/api/tokens", async (req, reply) => {
    const body = z.object({ label: z.string().min(1) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "label required" });
    return reply.code(201).send(deps.tokens.issue(body.data.label));
  });


  app.delete("/api/tokens/:label", async (req, _reply) => {
    const { label } = req.params as { label: string };
    const revoked = deps.tokens.revoke(label);
    return { revoked };
  });


  // T2.5 (EPIC-P2 §3): WebAuthn passkey registration + the biometric
  // decide path for `destructive` approvals. Identity is always the
  // caller's own bearer device token (identify()d fresh each call) — a
  // device can only ever register/use a passkey for itself, never for
  // another device's label.
  app.get("/api/webauthn/status", async (req, reply) => {
    if (!webauthnRoutes) return reply.code(501).send({ error: "webauthn not configured" });
    const label = callerLabel(req);
    if (!label) return reply.code(401).send({ error: "invalid device token" });
    return { registered: deps.webauthn!.store.getCredential(label) !== undefined };
  });


  app.post("/api/webauthn/register/options", async (req, reply) => {
    if (!webauthnRoutes) return reply.code(501).send({ error: "webauthn not configured" });
    const label = callerLabel(req);
    if (!label) return reply.code(401).send({ error: "invalid device token" });
    return webauthnRoutes.registerOptions(label);
  });


  app.post("/api/webauthn/register/verify", async (req, reply) => {
    if (!webauthnRoutes) return reply.code(501).send({ error: "webauthn not configured" });
    const label = callerLabel(req);
    if (!label) return reply.code(401).send({ error: "invalid device token" });
    const result = await webauthnRoutes.registerVerify(label, req.body as never);
    return result.ok ? result : reply.code(422).send(result);
  });
}
