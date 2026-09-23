import type { FastifyInstance } from "fastify";
import { isProjectPathAllowed } from "@uacc/core";
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
});

const SteerBody = z.intersection(
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("prompt"), text: z.string().min(1) }),
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
  const { deps, projectRoots, hostId, catalogRootFor, callerLabel, withAttachCmd } = ctx;

  app.get("/api/sessions", async () => Promise.all(deps.sessions.list().map((session) => withAttachCmd(session))));


  app.get("/api/sessions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
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
    try {
      await catalogRootFor(parsed.data.project);
      const record = await deps.sessions.create(parsed.data, callerLabel(req) ?? undefined);
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


  app.post("/api/sessions/:id/steer", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = SteerBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid steer input" });
    }
    const { inputId, revision, clientId, takeover, ...input } = parsed.data;
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
    const ack = await deps.sessions.stop(id, callerLabel(req) ?? undefined);
    return ack.ok ? ack : reply.code(422).send(ack);
  });


  app.post("/api/sessions/:id/archive", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ archived: z.boolean() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "archived boolean required" });
    try {
      return { ...deps.sessions.setArchived(id, body.data.archived), hostId };
    } catch (err) {
      const message = err instanceof Error ? err.message : "archive failed";
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
    const ack = await deps.sessions.requestBudgetTopUp(id, body.data.budgetUsd, body.data.reason, callerLabel(req) ?? undefined);
    return ack.ok ? ack : reply.code(422).send(ack);
  });
}
