import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolve } from "node:path";
import { buildGitGraph, isProjectPathAllowed } from "@ancientvoid/core";
import type { RouteContext } from "../../route-context.ts";

/**
 * ADR-0071: Git-Commit-Graph — gleiche Zielwahl wie `/api/graph` (`session=`/`project=`).
 */
export function registerGitGraphRoutes(app: FastifyInstance, ctx: RouteContext): void {
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

  app.get("/api/git-graph", async (req, reply) => {
    const root = await target(req, reply);
    if (!root) return;
    return buildGitGraph(root);
  });
}
