import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolve } from "node:path";
import { buildReleaseNotes, buildReleaseNotesDetail, isProjectPathAllowed, ReleaseNotesNotFoundError } from "@ancientvoid/core";
import type { RouteContext } from "../../route-context.ts";

/**
 * ADR-0093: Release-Notes aus dem lokalen Git-Verlauf — Zielwahl wie
 * `/api/git-graph` (`session=`/`project=`). Liste klein (keine Bodies, K5-Geist),
 * Detail je Merge-SHA on demand.
 */
export function registerReleaseNotesRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps, projectRoots } = ctx;

  async function target(req: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    const q = req.query as { session?: string; project?: string };
    if (q.session) {
      const session = deps.sessions.get(q.session);
      const root = session ? deps.sessions.workdirOf(q.session) : undefined;
      if (!session || !root) {
        await reply.code(404).send({ error: "unknown session" });
        return null;
      }
      return root;
    }
    if (q.project) {
      if (!(await isProjectPathAllowed(q.project, projectRoots))) {
        await reply.code(422).send({ error: "project path is outside the configured projectRoots" });
        return null;
      }
      return resolve(q.project);
    }
    await reply.code(400).send({ error: "session or project query param required" });
    return null;
  }

  app.get("/api/release-notes", async (req, reply) => {
    const root = await target(req, reply);
    if (!root) return;
    const q = req.query as { limit?: string };
    const limit = q.limit ? Number(q.limit) : NaN;
    return buildReleaseNotes(root, Number.isFinite(limit) && limit > 0 ? limit : undefined);
  });

  app.get("/api/release-notes/detail", async (req, reply) => {
    const root = await target(req, reply);
    if (!root) return;
    const q = req.query as { merge?: string };
    if (!q.merge) {
      await reply.code(400).send({ error: "merge query param required" });
      return;
    }
    try {
      return await buildReleaseNotesDetail(root, q.merge);
    } catch (err) {
      if (err instanceof ReleaseNotesNotFoundError) {
        await reply.code(404).send({ error: err.message });
        return;
      }
      throw err;
    }
  });
}
