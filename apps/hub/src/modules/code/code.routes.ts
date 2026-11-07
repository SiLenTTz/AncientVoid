import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolve } from "node:path";
import { CodeSearchMode, type ActionDefinition, type WorkspaceIdentity } from "@ancientvoid/contracts";
import { ActionRunner, BUILTIN_ACTIONS, detectedActions, isProjectPathAllowed, readCodeFile, searchCode, workspaceIdentity } from "@ancientvoid/core";
import { getSessionDiff } from "../sessions/diff.ts";
import { relativeDataDir } from "../search/search.ts";
import type { RouteContext } from "../../route-context.ts";

interface Target {
  root: string;
  identity: WorkspaceIdentity;
  base: string | null;
}

/**
 * T7.6: code on the phone. Search and viewer read a session's worktree
 * (`session=`) or a project inside projectRoots (`project=`); actions run
 * only in a session's worktree. Everything local — no search egress.
 */
export function registerCodeRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps, projectRoots, callerLabel } = ctx;
  const runner = new ActionRunner({ record: (sessionId, events) => deps.sessions.recordHubEvents(sessionId, events) });

  async function target(req: FastifyRequest, reply: FastifyReply): Promise<Target | null> {
    const q = req.query as { session?: string; project?: string };
    if (q.session) {
      const session = deps.sessions.get(q.session);
      const root = session ? deps.sessions.workdirOf(q.session) : undefined;
      if (!session || !root) {
        await reply.code(404).send({ error: "unknown session" });
        return null;
      }
      return { root, base: session.worktreeSha, identity: await workspaceIdentity(root, { id: session.id, base: session.worktreeSha }) };
    }
    if (q.project) {
      if (!(await isProjectPathAllowed(q.project, projectRoots))) {
        await reply.code(422).send({ error: "project path is outside the configured projectRoots" });
        return null;
      }
      const root = resolve(q.project);
      return { root, base: null, identity: await workspaceIdentity(root, null) };
    }
    await reply.code(400).send({ error: "session or project query param required" });
    return null;
  }

  app.get("/api/code/search", async (req, reply) => {
    const q = req.query as { q?: string; mode?: string };
    if (!q.q || q.q.length > 200) return reply.code(400).send({ error: "q required (max 200 chars)" });
    const mode = CodeSearchMode.safeParse(q.mode ?? "text");
    if (!mode.success) return reply.code(400).send({ error: "mode must be text or symbol" });
    const t = await target(req, reply);
    if (!t) return;
    const exclude = deps.dataDir ? [relativeDataDir(t.root, deps.dataDir)].filter((d): d is string => d !== undefined) : [];
    try {
      return { identity: t.identity, ...(await searchCode(t.root, q.q, { mode: mode.data, exclude })) };
    } catch (err) {
      return reply.code(422).send({ error: err instanceof Error ? err.message : "Suche fehlgeschlagen" });
    }
  });

  app.get("/api/code/file", async (req, reply) => {
    const q = req.query as { path?: string };
    if (!q.path) return reply.code(400).send({ error: "path required" });
    const t = await target(req, reply);
    if (!t) return;
    let changed: { additions: number; deletions: number } | null = null;
    if (t.identity.kind === "session") {
      const diff = await getSessionDiff(t.root, t.base).catch(() => null);
      // AC-P2-1: eine Datei kann in Commits UND uncommittet geändert
      // sein — die +/- einer Datei sind die Summe über alle Abschnitte.
      const touched = [...(diff?.commits ?? []).flatMap((c) => c.files), ...(diff?.files ?? [])].filter(
        (f) => f.path === q.path,
      );
      if (touched.length > 0) {
        changed = touched.reduce(
          (acc, f) => ({ additions: acc.additions + f.additions, deletions: acc.deletions + f.deletions }),
          { additions: 0, deletions: 0 },
        );
      }
    }
    const file = await readCodeFile(t.root, q.path, t.identity, changed);
    if (!file) return reply.code(404).send({ error: "file not found, not a regular file, or outside the workspace" });
    return file;
  });

  async function actionsFor(sessionId: string): Promise<{ root: string; actions: ActionDefinition[] } | null> {
    const root = deps.sessions.workdirOf(sessionId);
    if (!root || !deps.sessions.get(sessionId)) return null;
    const configured = deps.actions ?? [];
    const seen = new Set<string>();
    const actions = [...configured, ...(await detectedActions(root)), ...BUILTIN_ACTIONS].filter((a) => !seen.has(a.id) && seen.add(a.id));
    return { root, actions };
  }

  app.get("/api/sessions/:id/actions", async (req, reply) => {
    const { id } = req.params as { id: string };
    const found = await actionsFor(id);
    if (!found) return reply.code(404).send({ error: "unknown session" });
    return { actions: found.actions, runs: runner.list(id) };
  });

  app.get("/api/sessions/:id/actions/runs/:runId", async (req, reply) => {
    const { id, runId } = req.params as { id: string; runId: string };
    const run = runner.get(id, runId);
    return run ?? reply.code(404).send({ error: "unknown run" });
  });

  app.post("/api/sessions/:id/actions/:action", async (req, reply) => {
    const { id, action } = req.params as { id: string; action: string };
    const body = (req.body ?? {}) as { params?: Record<string, unknown> };
    const found = await actionsFor(id);
    if (!found) return reply.code(404).send({ error: "unknown session" });
    const def = found.actions.find((a) => a.id === action);
    if (!def) return reply.code(404).send({ error: "unknown action" });
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.params ?? {})) {
      if (typeof v !== "string") return reply.code(400).send({ error: `Parameter „${k}“ muss Text sein.` });
      if (v !== "") params[k] = v;
    }
    try {
      const run = await runner.start(id, found.root, def, params, callerLabel(req));
      return reply.code(202).send(run);
    } catch (err) {
      return reply.code(409).send({ error: err instanceof Error ? err.message : "Aktion nicht gestartet" });
    }
  });
}
