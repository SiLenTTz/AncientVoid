import { AttachmentId, SaveDraftInput, ToolPermissionRequest, type SteerInput } from "@uacc/contracts";
import type { FastifyInstance } from "fastify";
import { DraftStore, isProjectPathAllowed } from "@uacc/core";
import { getSessionDiff, getSessionFileHunks } from "./diff.ts";
import { ENV_VAR_NAME } from "@uacc/contracts";
import { z } from "zod";
import type { RouteContext } from "../../route-context.ts";

const CreateSessionBody = z.object({
  adapter: z.string().min(1),
  project: z.string().min(1),
  prompt: z.string().optional(),
  model: z.string().optional(),
  budgetUsd: z.number().positive().nullable().optional(),
  // ENV_VAR_NAME (@uacc/contracts): rejects a malicious env KEY here,
  // early, with a clean 400 — see SessionSpec's own doc comment and
  // TmuxRunner.spawn()'s matching runtime guard (defense in depth, same
  // pattern, same regex, single source of truth).
  env: z.record(z.string().regex(ENV_VAR_NAME), z.string()).optional(),
  args: z.record(z.unknown()).optional(),
  /** Adoption (ADR-0011): continue an externally discovered session. */
  adoptNativeSessionId: z.string().min(1).optional(),
  /** Read-only mirror (ADR-0011 Erweiterung): show an observed opencode
   * session's conversation without adopting or running anything. */
  mirrorNativeSessionId: z.string().min(1).optional(),
  /** T7.10: uploaded files for the first prompt. */
  attachmentIds: z.array(AttachmentId).max(20).optional(),
});

const SteerBody = z.intersection(
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("prompt"), text: z.string(), attachmentIds: z.array(AttachmentId).max(20).optional() }),
    z.object({ kind: z.literal("stop") }),
    z.object({ kind: z.literal("park") }),
    z.object({ kind: z.literal("resume") }),
  ]),
  z.object({
    inputId: z.string().min(1).optional(),
    revision: z.number().int().nonnegative().optional(),
    clientId: z.string().min(1).optional(),
    takeover: z.boolean().optional(),
  }),
);

/** Session lifecycle, events, steering, diff and budget. */
export function registerSessionsRoutes(app: FastifyInstance, ctx: RouteContext): void {
  /** T7.10: uploaded ids → what the adapter gets (waits for extraction). */
  async function resolveAttachments(ids: string[]) {
    if (!ctx.deps.attachments) throw new Error("Anhänge sind auf diesem Hub nicht eingerichtet.");
    return ctx.deps.attachments.resolve(ids);
  }
  const { deps, projectRoots, hostId, catalogRootFor, callerLabel, withAttachCmd } = ctx;

  app.get("/api/sessions", async () => Promise.all(deps.sessions.list().map((session) => withAttachCmd(session))));


  app.get("/api/sessions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    // A mirror session pulls its delta on read (ADR-0011 Erweiterung):
    // the PWA polls this route while the chat is open — new opencode
    // messages become events and go out over the WS immediately.
    if (deps.sessions.get(id)?.controlMode === "mirror") {
      await deps.sessions.refreshMirror(id).catch(() => undefined);
    }
    const session = deps.sessions.get(id);
    if (!session) return reply.code(404).send({ error: "unknown session" });
    return withAttachCmd(session);
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
    // T7.4: an agent only requests — a human starts it from the queue.
    if (req.policy?.decision === "approve") {
      const ack = await deps.sessions.requestAgentAction("session.create", null, parsed.data, req.policy.actor);
      return reply.code(ack.approvalId ? 202 : 422).send(ack);
    }
    try {
      await catalogRootFor(parsed.data.project);
      const { attachmentIds, ...spec } = parsed.data;
      const attachments = attachmentIds?.length ? await resolveAttachments(attachmentIds) : undefined;
      const record = await deps.sessions.create({ ...spec, ...(attachments ? { attachments } : {}) }, callerLabel(req) ?? undefined);
      return reply.code(201).send({ ...record, hostId });
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


  app.get("/api/sessions/:id/diff", async (req, reply) => {
    // T1.6-4/T1.6-5: session.project already passed the containment check
    // at session-creation time — no client-supplied path here, so no
    // second isProjectPathAllowed() call is needed (unlike /api/skills or
    // /api/prompt-enhance, which take project fresh from the request body).
    // T2.2: diff the session's real live workdir (the T2.1 worktree when
    // isolation succeeded) against its real base_sha, not always the raw
    // project path against HEAD.
    const { id } = req.params as { id: string };
    const session = deps.sessions.get(id);
    if (!session) return reply.code(404).send({ error: "unknown session" });
    const workdir = deps.sessions.workdirOf(id) ?? session.project;
    return getSessionDiff(workdir, session.worktreeSha);
  });


  app.get("/api/sessions/:id/diff/hunk", async (req, reply) => {
    // T2.2 expand-on-tap: re-fetch one file's hunks in full after the main
    // /diff response collapsed them under K3. Same trust boundary as
    // /diff above (session.project/workdir are already vetted; `path` is
    // only ever passed to `execFile` with an argument array, never a
    // shell, so it cannot inject a command — it can only ask git about a
    // path that doesn't exist, which git reports as an empty result).
    const { id } = req.params as { id: string };
    const q = req.query as { path?: string };
    if (!q.path || q.path.includes("..")) return reply.code(400).send({ error: "invalid path" });
    const session = deps.sessions.get(id);
    if (!session) return reply.code(404).send({ error: "unknown session" });
    const workdir = deps.sessions.workdirOf(id) ?? session.project;
    const hunks = await getSessionFileHunks(workdir, q.path, session.worktreeSha);
    return { path: q.path, hunks };
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


  // T7.2 / ADR-0018 §3: a provider asks before a tool runs (called by the
  // permission bridge with its session-bound token). Answer by polling:
  // survives a hub restart, and no HTTP request is held for minutes.
  app.post("/api/sessions/:id/tool-permissions", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = ToolPermissionRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid tool permission request" });
    const res = await deps.sessions.requestToolPermission(id, parsed.data);
    return res.ok ? reply.code(201).send({ id: res.id }) : reply.code(422).send({ error: res.detail });
  });

  app.get("/api/sessions/:id/tool-permissions/:pid", async (req, reply) => {
    const { id, pid } = req.params as { id: string; pid: string };
    const waitMs = Math.min(Math.max(Number((req.query as { waitMs?: string }).waitMs ?? 0) || 0, 0), 25_000);
    const deadline = Date.now() + waitMs;
    for (;;) {
      const poll = await deps.sessions.pollToolPermission(id, pid);
      if (!poll) return reply.code(404).send({ error: "unknown tool permission request" });
      if (poll.state === "answered" || Date.now() >= deadline) return poll;
      await new Promise((r) => setTimeout(r, 250));
    }
  });

  app.post("/api/sessions/:id/steer", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = SteerBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid steer input" });
    }
    const { inputId, revision, clientId, takeover, ...raw } = parsed.data;
    let input: SteerInput;
    if (raw.kind === "prompt") {
      const { attachmentIds, ...prompt } = raw;
      if (!prompt.text.trim() && !attachmentIds?.length) return reply.code(400).send({ error: "invalid steer input" });
      try {
        input = attachmentIds?.length ? { ...prompt, attachments: await resolveAttachments(attachmentIds) } : prompt;
      } catch (err) {
        return reply.code(422).send({ ok: false, detail: err instanceof Error ? err.message : "Anhang fehlt" });
      }
    } else input = raw;
    if (req.policy?.decision === "approve") {
      if (!deps.sessions.get(id)) return reply.code(404).send({ ok: false, detail: "unknown session" });
      const ack =
        input.kind === "prompt"
          ? await deps.sessions.requestAgentAction("steer.prompt", id, { input, typed: input.text }, req.policy.actor)
          : input.kind === "park" || input.kind === "stop"
            ? await deps.sessions.requestAgentAction(input.kind === "park" ? "session.park" : "session.stop", id, {}, req.policy.actor)
            : { ok: false, detail: "Agenten können eine Session nur mit einem Prompt fortsetzen." };
      return reply.code("approvalId" in ack && ack.approvalId ? 202 : 422).send(ack);
    }
    const ack = await deps.sessions.steer(id, input, callerLabel(req) ?? undefined, {
      ...(inputId !== undefined ? { inputId } : {}),
      ...(revision !== undefined ? { revision } : {}),
      ...(clientId !== undefined ? { clientId } : {}),
      ...(takeover ? { takeover } : {}),
    });
    return ack.ok ? ack : reply.code(422).send(ack);
  });


  // "Ins Projekt übernehmen": commit the session worktree and merge it
  // into the project checkout. 409 with a reason the user can act on.
  app.post("/api/sessions/:id/apply", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deps.sessions.get(id)) return reply.code(404).send({ ok: false, detail: "unknown session" });
    const result = await deps.sessions.applyToProject(id, callerLabel(req) ?? undefined);
    return result.ok ? result : reply.code(409).send(result);
  });


  app.post("/api/sessions/:id/stop", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (req.policy?.decision === "approve") {
      if (!deps.sessions.get(id)) return reply.code(404).send({ ok: false, detail: "unknown session" });
      const pending = await deps.sessions.requestAgentAction("session.stop", id, {}, req.policy.actor);
      return reply.code(pending.approvalId ? 202 : 422).send(pending);
    }
    const ack = await deps.sessions.stop(id, callerLabel(req) ?? undefined);
    return ack.ok ? ack : reply.code(422).send(ack);
  });


  app.post("/api/sessions/:id/archive", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ archived: z.boolean() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "archived boolean required" });
    try {
      return { ...(await deps.sessions.archive(id, body.data.archived)), hostId };
    } catch (err) {
      const message = err instanceof Error ? err.message : "archive failed";
      if (message.startsWith("unknown session")) return reply.code(404).send({ error: message });
      throw err;
    }
  });

  // Delete for good — events, worktree, row. The PWA asks before calling.
  app.delete("/api/sessions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ack = await deps.sessions.delete(id);
    if (!ack.ok) return reply.code(409).send({ error: ack.detail ?? "delete refused" });
    return reply.code(204).send();
  });


  // T8.4 (ADR-0025): the shared, revisioned draft of a session.
  const drafts = new DraftStore(deps.tokens.database);
  app.get("/api/sessions/:id/draft", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deps.sessions.get(id)) return reply.code(404).send({ error: "unknown session" });
    return drafts.get(id);
  });
  app.put("/api/sessions/:id/draft", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deps.sessions.get(id)) return reply.code(404).send({ error: "unknown session" });
    const body = SaveDraftInput.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "text, attachmentIds, baseRevision required" });
    const result = drafts.save(id, body.data, callerLabel(req));
    return result.ok ? result.draft : reply.code(409).send({ error: "Ein anderes Gerät hat den Entwurf inzwischen geändert.", current: result.conflict });
  });

  // T8.6: rename and pin — overview metadata, same class as archive.
  app.post("/api/sessions/:id/meta", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ title: z.string().max(200).nullable().optional(), pinned: z.boolean().optional() }).strict().safeParse(req.body);
    if (!body.success || (body.data.title === undefined && body.data.pinned === undefined)) return reply.code(400).send({ error: "title or pinned required" });
    try {
      return { ...deps.sessions.setMeta(id, { ...(body.data.title !== undefined ? { title: body.data.title } : {}), ...(body.data.pinned !== undefined ? { pinned: body.data.pinned } : {}) }), hostId };
    } catch (err) {
      const message = err instanceof Error ? err.message : "update failed";
      if (message.startsWith("unknown session")) return reply.code(404).send({ error: message });
      throw err;
    }
  });


  app.post("/api/sessions/:id/budget", async (req, reply) => {
    // T2.7 (EPIC-P2 §3 "Budget-Top-up (write-Klasse)"). Same shape as
    // /steer: 422 (not 200) when it's parked pending approval, since
    // ack.ok is false in that case too — the client already knows how to
    // handle that from the steer route.
    const { id } = req.params as { id: string };
    const body = z.object({ budgetUsd: z.number().positive(), reason: z.string().min(1).optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid budget" });
    if (req.policy?.decision === "approve") {
      const pending = await deps.sessions.requestAgentAction("budget.increase", id, { newBudgetUsd: body.data.budgetUsd, reason: body.data.reason ?? null }, req.policy.actor);
      return reply.code(pending.approvalId ? 202 : 422).send(pending);
    }
    const ack = await deps.sessions.requestBudgetTopUp(id, body.data.budgetUsd, body.data.reason, callerLabel(req) ?? undefined);
    return ack.ok ? ack : reply.code(422).send(ack);
  });
}
