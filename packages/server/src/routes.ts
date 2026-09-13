import type { FastifyInstance } from "fastify";
import type { SessionManager, TokenService, AdapterRegistry } from "@uacc/core";
import { z } from "zod";

const CreateSessionBody = z.object({
  adapter: z.string().min(1),
  project: z.string().min(1),
  prompt: z.string().optional(),
  model: z.string().optional(),
  budgetUsd: z.number().positive().nullable().optional(),
  env: z.record(z.string()).optional(),
  args: z.record(z.unknown()).optional(),
});

const SteerBody = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("prompt"), text: z.string().min(1) }),
  z.object({ kind: z.literal("stop") }),
  z.object({ kind: z.literal("park") }),
  z.object({ kind: z.literal("resume") }),
]);

export function registerRoutes(
  app: FastifyInstance,
  deps: {
    sessions: SessionManager;
    tokens: TokenService;
    registry: AdapterRegistry;
  },
): void {
  app.get("/api/health", async () => ({
    ok: true,
    adapters: deps.registry.list().map((a) => ({
      id: a.id,
      version: a.adapter.version,
      capabilities: a.capabilities,
      module: a.module,
    })),
    serverTime: new Date().toISOString(),
  }));

  app.get("/api/adapters", async () =>
    deps.registry.list().map((a) => ({
      id: a.id,
      version: a.adapter.version,
      capabilities: a.capabilities,
    })),
  );

  app.get("/api/sessions", async () => deps.sessions.list());

  app.get("/api/sessions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = deps.sessions.get(id);
    if (!session) return reply.code(404).send({ error: "unknown session" });
    return session;
  });

  app.post("/api/sessions", async (req, reply) => {
    const parsed = CreateSessionBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid session spec", issues: parsed.error.issues });
    }
    try {
      const record = await deps.sessions.create(parsed.data);
      return reply.code(201).send(record);
    } catch (err) {
      return reply.code(422).send({
        error: err instanceof Error ? err.message : "session creation failed",
      });
    }
  });

  app.get("/api/sessions/:id/events", async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { afterSeq?: string; limit?: string };
    const afterSeq = Number(q.afterSeq ?? 0);
    const limit = Math.min(Number(q.limit ?? 500), 2000);
    if (!deps.sessions.get(id)) return reply.code(404).send({ error: "unknown session" });
    return deps.sessions.tail(id, Number.isFinite(afterSeq) ? afterSeq : 0, limit);
  });

  app.get("/api/sessions/:id/blobs/:hash", async (req, reply) => {
    const { id, hash } = req.params as { id: string; hash: string };
    if (!/^[a-f0-9]{64}$/.test(hash)) return reply.code(400).send({ error: "invalid hash" });
    try {
      const buf = await deps.sessions.readBlob(id, hash);
      return reply.type("application/octet-stream").send(buf);
    } catch {
      return reply.code(404).send({ error: "unknown blob" });
    }
  });

  app.post("/api/sessions/:id/steer", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = SteerBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid steer input" });
    }
    const ack = await deps.sessions.steer(id, parsed.data);
    return ack.ok ? ack : reply.code(422).send(ack);
  });

  app.post("/api/sessions/:id/stop", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ack = await deps.sessions.stop(id);
    return ack.ok ? ack : reply.code(422).send(ack);
  });

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
}
