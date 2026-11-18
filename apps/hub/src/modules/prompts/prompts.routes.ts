import type { FastifyInstance } from "fastify";
import { isProjectPathAllowed, recommendForPrompt, writeProjectArtifact } from "@ancientvoid/core";
import { enhancePrompt, RewriteFailed, type LocalRewriteModel } from "./enhance.ts";
import { projectContext } from "./project-context.ts";
import { appendOptimizerFeedback } from "./optimizer-feedback.ts";
import { z } from "zod";
import type { RouteContext } from "../../route-context.ts";

const EnhancePromptBody = z.object({
  adapter: z.string().min(1),
  text: z.string().min(1),
  project: z.string().min(1),
});

const OptimizerFeedbackBody = z.object({
  adapter: z.string().min(1),
  project: z.string().min(1),
  original: z.string().min(1),
  enhanced: z.string().min(1),
  decision: z.enum(["accepted", "rejected"]),
  /** EPIC-P68: which stage wrote the suggestion ("local" or an adapter id). */
  engine: z.string().max(80).optional(),
  costUsd: z.number().optional(),
  latencyMs: z.number(),
});

/** Prompt enhancer, optimizer feedback, skills and recommendations (T1.5, T3.9, T5.10). */
export function registerPromptsRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps, projectRoots, skillsFor } = ctx;
  // EPIC-P68 (ADR-0089): same local model as text commands (T9.2), with
  // its own budget — the planner's 12s timeout is for one JSON intent.
  const local: LocalRewriteModel | undefined = deps.assistantModel
    ? {
        url: deps.assistantModel.url,
        model: deps.assistantModel.model,
        ...(deps.assistantModel.apiKey ? { apiKey: deps.assistantModel.apiKey } : {}),
        ...(deps.assistantModel.fetch ? { fetch: deps.assistantModel.fetch } : {}),
      }
    : undefined;
  const registrationOf = (adapter: string) => {
    const registered = deps.registry.get(adapter);
    return {
      ...(registered?.module !== undefined ? { module: registered.module } : {}),
      ...(registered?.config !== undefined ? { config: registered.config as Record<string, unknown> } : {}),
    };
  };

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
      // BUG-0061: the adapter one-shot is picked from the registration
      // (module + config), not the free-form adapter id — a dsh ACP
      // registration can carry any id ("deepseek", …).
      const context = await projectContext(parsed.data.project, await skillsFor(parsed.data.project));
      return await enhancePrompt(parsed.data.adapter, parsed.data.text, parsed.data.project, {
        registration: registrationOf(parsed.data.adapter),
        ...(local ? { local } : {}),
        context,
      });
    } catch (err) {
      return reply.code(502).send({
        error: err instanceof Error ? err.message : "prompt enhancement failed",
        ...(err instanceof RewriteFailed ? { skipped: err.skipped } : {}),
      });
    }
  });


  app.post("/api/prompt-optimizer/feedback", async (req, reply) => {
    // T3.9 (EPIC-P3 §3 Learning-Loop): fire-and-forget from the PWA's own
    // Composer, once per shown suggestion (accepted or discarded) — a
    // plain local JSONL append, never sent anywhere else ("niemals Cloud,
    // niemals Telemetrie").
    if (!deps.dataDir) return reply.code(501).send({ error: "prompt-optimizer feedback storage not configured" });
    const parsed = OptimizerFeedbackBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid feedback body", issues: parsed.error.issues });
    const { costUsd, engine, ...rest } = parsed.data;
    await appendOptimizerFeedback(deps.dataDir, { ...rest, ...(costUsd !== undefined ? { costUsd } : {}), ...(engine !== undefined ? { engine } : {}) });
    return { ok: true };
  });


  app.get("/api/skills", async (req, reply) => {
    // T1.5-10/ADR-0005: source is the target project itself, not a
    // hub-wide registry (Nutzer-Rückfrage 1). Same containment guard as
    // sessions/enhance — a phone client never gets to read arbitrary
    // filesystem paths outside the configured roots.
    const q = req.query as { project?: string };
    if (!q.project) return reply.code(400).send({ error: "project query param required" });
    if (!(await isProjectPathAllowed(q.project, projectRoots))) {
      return reply.code(422).send({ error: "project path is outside the configured projectRoots" });
    }
    return { items: await skillsFor(q.project) };
  });


  app.post("/api/prompt-recommendation", async (req, reply) => {
    const parsed = z.object({ project: z.string().min(1), text: z.string().min(1).max(8000) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid recommendation request" });
    if (!(await isProjectPathAllowed(parsed.data.project, projectRoots))) {
      return reply.code(422).send({ error: "project path is outside the configured projectRoots" });
    }
    // null = nothing worth suggesting; sent as JSON so clients can tell.
    const recommendation = recommendForPrompt(parsed.data.text, await skillsFor(parsed.data.project));
    return reply.type("application/json").send(JSON.stringify(recommendation));
  });


  app.post("/api/skills", async (req, reply) => {
    const parsed = z
      .object({
        project: z.string().min(1),
        kind: z.enum(["skill", "agent", "workflow"]),
        name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        description: z.string().min(1).max(500),
        draft: z.string().min(1).max(8000),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid artifact" });
    if (!(await isProjectPathAllowed(parsed.data.project, projectRoots))) {
      return reply.code(422).send({ error: "project path is outside the configured projectRoots" });
    }
    try {
      const written = await writeProjectArtifact(parsed.data.project, parsed.data);
      return reply.code(201).send(written);
    } catch (err) {
      const message = err instanceof Error ? err.message : "artifact write failed";
      if (message === "artifact already exists") return reply.code(409).send({ error: message });
      if (message === "invalid artifact name" || message === "draft too large") return reply.code(400).send({ error: message });
      throw err;
    }
  });
}
