import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PushSubscribeInput } from "@uacc/contracts";
import type { PushService, TokenService } from "@uacc/core";
import { extractToken } from "../../platform/auth.ts";

/** T8.3 (ADR-0026): Web Push — switch, subscriptions, test. */
export function registerPushRoutes(app: FastifyInstance, deps: { push: PushService; tokens: TokenService }): void {
  const device = (req: Parameters<typeof extractToken>[0]) => {
    const token = extractToken(req);
    return token ? (deps.tokens.identify(token)?.label ?? null) : null;
  };

  app.get("/api/push", async (req) => ({
    enabled: deps.push.enabled(),
    publicKey: deps.push.publicKey(),
    subscriptions: deps.push.list(device(req)),
  }));

  app.put("/api/push/enabled", async (req, reply) => {
    const body = z.object({ enabled: z.boolean() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "enabled boolean required" });
    deps.push.setEnabled(body.data.enabled);
    return { enabled: deps.push.enabled(), publicKey: deps.push.publicKey() };
  });

  app.post("/api/push/subscriptions", async (req, reply) => {
    const body = PushSubscribeInput.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "endpoint and keys required" });
    const res = deps.push.subscribe(body.data, device(req));
    return res.ok ? reply.code(201).send({ ok: true }) : reply.code(422).send({ error: res.detail });
  });

  app.delete("/api/push/subscriptions", async (req, reply) => {
    const body = z.object({ endpoint: z.string().url() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "endpoint required" });
    return { ok: deps.push.unsubscribe(body.data.endpoint) };
  });

  app.post("/api/push/test", async (req) => deps.push.test(device(req)));
}
