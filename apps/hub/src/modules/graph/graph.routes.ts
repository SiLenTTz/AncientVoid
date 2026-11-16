import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { buildFileGraph, diagnoseGraph, isProjectPathAllowed } from "@ancientvoid/core";
import { relativeDataDir } from "../search/search.ts";
import type { RouteContext } from "../../route-context.ts";

interface GraphTarget {
  root: string;
  /** Hauptprojekt der Session — die Trust-Freigabe gilt dafür, nicht dem Worktree (wie P46). */
  trustBase: string;
}

/**
 * EPIC-P48 (ADR-0062): Repo-Graph — Dateien als Knoten, Verweise als Kanten.
 * Gleiche Zielwahl und gleiches Containment wie die Code-Routen (`session=`/`project=`);
 * dataDir bleibt ausgeschlossen (BUG-0014). Diagnose nur auf ausdrückliche Anfrage.
 */
export function registerGraphRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps, projectRoots } = ctx;

  async function target(req: FastifyRequest, reply: FastifyReply): Promise<GraphTarget | null> {
    const q = req.query as { session?: string; project?: string };
    if (q.session) {
      const session = deps.sessions.get(q.session);
      const root = session ? deps.sessions.workdirOf(q.session) : undefined;
      if (!session || !root) {
        await reply.code(404).send({ error: "unknown session" });
        return null;
      }
      return { root, trustBase: session.project };
    }
    if (q.project) {
      if (!(await isProjectPathAllowed(q.project, projectRoots))) {
        await reply.code(422).send({ error: "project path is outside the configured projectRoots" });
        return null;
      }
      const root = resolve(q.project);
      return { root, trustBase: root };
    }
    await reply.code(400).send({ error: "session or project query param required" });
    return null;
  }

  app.get("/api/graph", async (req, reply) => {
    const t = await target(req, reply);
    if (!t) return;
    const exclude = deps.dataDir ? [relativeDataDir(t.root, deps.dataDir)].filter((d): d is string => d !== undefined) : [];
    return buildFileGraph(t.root, { exclude });
  });

  app.post("/api/graph/diagnose", async (req, reply) => {
    const t = await target(req, reply);
    if (!t) return;
    const exclude = deps.dataDir ? [relativeDataDir(t.root, deps.dataDir)].filter((d): d is string => d !== undefined) : [];
    const graph = await buildFileGraph(t.root, { exclude });
    const key = await realpath(t.trustBase).catch(() => t.trustBase);
    const trusted = deps.trust ? deps.trust.get(key).trusted : false;
    return diagnoseGraph(t.root, graph.nodes.map((n) => n.path), { trusted });
  });
}
