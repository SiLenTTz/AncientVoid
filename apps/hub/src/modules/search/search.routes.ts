import type { FastifyInstance } from "fastify";
import { isProjectPathAllowed } from "@uacc/core";
import { ensureIndexed, indexStatus, isQmdAvailable, readProjectFile, relativeDataDir, searchProject } from "./search.ts";
import type { RouteContext } from "../../route-context.ts";

/** Local project search over qmd (T3.8). */
export function registerSearchRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps, projectRoots, indexingInFlight } = ctx;

  // T3.8 (EPIC-P3 §3 "Sprachsuche"): read-class, no approval needed — a
  // search never changes anything. All three routes validate `project`
  // against projectRoots exactly like session creation does (T1.5-4).
  app.get("/api/search/status", async (req, reply) => {
    const { project } = req.query as { project?: string };
    if (!project) return reply.code(400).send({ error: "project query param required" });
    if (!(await isProjectPathAllowed(project, projectRoots))) {
      return reply.code(422).send({ error: "project path is outside the configured projectRoots" });
    }
    return indexStatus(project);
  });


  app.get("/api/search", async (req, reply) => {
    const { project, q } = req.query as { project?: string; q?: string };
    if (!project || !q) return reply.code(400).send({ error: "project and q query params required" });
    if (!(await isProjectPathAllowed(project, projectRoots))) {
      return reply.code(422).send({ error: "project path is outside the configured projectRoots" });
    }
    if (!(await isQmdAvailable())) {
      return reply.code(501).send({ error: "search not available — qmd CLI not installed on this host" });
    }
    const status = await indexStatus(project);
    if (!status.indexed) {
      if (!indexingInFlight.has(project)) {
        const job = ensureIndexed(project).finally(() => indexingInFlight.delete(project));
        indexingInFlight.set(project, job);
        job.catch((err) => req.log.error({ err, project }, "search index build failed"));
      }
      return reply.code(202).send({ status: "indexing", results: [] });
    }
    try {
      // BUG-0014: exclude the hub's own dataDir (worktree copies of every
      // real markdown file) when it happens to live inside the searched
      // project — a real, ordinary setup, not a contrived edge case.
      const excludeRelDirs = deps.dataDir ? [relativeDataDir(project, deps.dataDir)].filter((d): d is string => d !== undefined) : [];
      const results = await searchProject(project, q, 5, excludeRelDirs);
      return { status: "ready", results };
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : "search failed" });
    }
  });


  app.get("/api/search/file", async (req, reply) => {
    const { project, path } = req.query as { project?: string; path?: string };
    if (!project || !path) return reply.code(400).send({ error: "project and path query params required" });
    if (!(await isProjectPathAllowed(project, projectRoots))) {
      return reply.code(422).send({ error: "project path is outside the configured projectRoots" });
    }
    const file = await readProjectFile(project, path);
    if (!file) return reply.code(404).send({ error: "file not found, not a regular file, or outside the project" });
    return file;
  });
}
