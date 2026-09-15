import type { FastifyInstance } from "fastify";
import type { SessionManager, TokenService, AdapterRegistry } from "@uacc/core";
import { discoverProjects, isProjectPathAllowed } from "@uacc/core";
import { enhancePrompt } from "./enhance.ts";
import { z } from "zod";

const EnhancePromptBody = z.object({
  adapter: z.string().min(1),
  text: z.string().min(1),
  project: z.string().min(1),
});

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
    projectRoots?: string[];
  },
): void {
  const projectRoots = deps.projectRoots ?? [];
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

  app.get("/api/adapters/:id/usage", async (req, reply) => {
    // ADR-0004: account-level usage/quota, not session-scoped. `usage`
    // reflects capabilities().usage — false means "verified absent for
    // this adapter" (e.g. codex), never guessed as 0%. `snapshot` is null
    // whenever this adapter hasn't emitted one yet, distinct from "0%
    // used": a session that only just started may not have seen one.
    const { id } = req.params as { id: string };
    const registered = deps.registry.list().find((a) => a.id === id);
    if (!registered) return reply.code(404).send({ error: "unknown adapter" });
    const snapshot = deps.sessions.getAdapterUsage(id);
    return {
      adapterId: id,
      supported: registered.capabilities.usage,
      quota: snapshot?.quota ?? null,
      observedAt: snapshot?.observedAt ?? null,
    };
  });

  app.post("/api/prompt-enhance", async (req, reply) => {
    // T1.5-8: never automatic, only on explicit request (this route is
    // the "on request" — nothing else calls it). Real cost/latency come
    // back to the caller so the UI can show what this click actually
    // spent, per-call — see enhance.ts's own doc comment for why this
    // isn't folded into ADR-0004's aggregate usage cache.
    const parsed = EnhancePromptBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid enhance request", issues: parsed.error.issues });
    }
    // Same containment rule as session creation (T1.5-4) — the enhance
    // call's cwd is this path (found necessary via a real test, see
    // enhance.ts), so it needs the identical guard against an
    // outside-the-roots path.
    if (!(await isProjectPathAllowed(parsed.data.project, projectRoots))) {
      return reply.code(422).send({ error: "project path is outside the configured projectRoots" });
    }
    try {
      return await enhancePrompt(parsed.data.adapter, parsed.data.text, parsed.data.project);
    } catch (err) {
      return reply.code(502).send({
        error: err instanceof Error ? err.message : "prompt enhancement failed",
      });
    }
  });

  app.get("/api/projects", async () => {
    // T1.5-4: fresh scan on every call (not cached at startup) — a repo
    // cloned after the hub started should show up without a restart.
    // Startup-time readability warnings are logged once in createHubApp();
    // this response carries them again so a client can surface them too.
    const { projects, warnings } = await discoverProjects(projectRoots);
    return { projects, warnings };
  });

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
    // T1.5-4/AC-P1.5-5: a client (a phone on the tailnet) never gets to
    // start a session outside the configured roots — ADR-0001's allowlist
    // pattern ("never trust a client-supplied path at face value").
    // Symlink escapes are resolved away, not just string-prefix-checked.
    if (!(await isProjectPathAllowed(parsed.data.project, projectRoots))) {
      return reply.code(422).send({ error: "project path is outside the configured projectRoots" });
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
