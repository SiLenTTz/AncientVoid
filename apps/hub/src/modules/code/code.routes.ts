import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createReadStream } from "node:fs";
import { basename, resolve } from "node:path";
import { CodeSearchMode, type ActionDefinition, type WorkspaceIdentity } from "@ancientvoid/contracts";
import { ActionRunner, BUILTIN_ACTIONS, detectedActions, fileMeta, isProjectPathAllowed, listTree, mimeOf, readCodeFile, readRange, resolveFile, searchCode, workspaceIdentity } from "@ancientvoid/core";
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

  // EPIC-P46 (ADR-0058): Projekt-Explorer. Gleiche Zielwahl (session=/project=) und Containment wie oben.
  app.get("/api/code/tree", async (req, reply) => {
    const q = req.query as { path?: string; offset?: string; limit?: string; ignored?: string };
    const t = await target(req, reply);
    if (!t) return;
    const listing = await listTree(t.root, q.path ?? "", t.identity, {
      offset: Number(q.offset ?? 0) || 0,
      ...(Number(q.limit) > 0 ? { limit: Number(q.limit) } : {}),
      ignored: q.ignored === "1",
    });
    return listing ?? reply.code(404).send({ error: "Ordner nicht gefunden, nicht lesbar oder außerhalb des Projekts" });
  });

  app.get("/api/code/meta", async (req, reply) => {
    const q = req.query as { path?: string };
    if (!q.path) return reply.code(400).send({ error: "path required" });
    const t = await target(req, reply);
    if (!t) return;
    const meta = await fileMeta(t.root, q.path, t.identity);
    return meta ?? reply.code(404).send({ error: "file not found, not a regular file, or outside the workspace" });
  });

  app.get("/api/code/range", async (req, reply) => {
    const q = req.query as { path?: string; offset?: string; length?: string; rev?: string; as?: string; encoding?: string };
    if (!q.path) return reply.code(400).send({ error: "path required" });
    if (q.as !== "text" && q.as !== "bytes") return reply.code(400).send({ error: "as must be text or bytes" });
    const encoding = q.encoding === "utf-16le" || q.encoding === "utf-16be" ? q.encoding : "utf-8";
    const t = await target(req, reply);
    if (!t) return;
    const res = await readRange(t.root, q.path, {
      offset: Number(q.offset ?? 0) || 0,
      ...(Number(q.length) > 0 ? { length: Number(q.length) } : {}),
      ...(q.rev ? { revision: q.rev } : {}),
      as: q.as,
      encoding,
    });
    if (res.ok) return res.range;
    if (res.reason === "revision_changed") return reply.code(409).send({ error: "Die Datei hat sich geändert — neu laden.", revision: res.revision });
    return reply.code(404).send({ error: "file not found, not a regular file, or outside the workspace" });
  });

  /** Originalbytes mit Range-Unterstützung (Medien-Seek, Download). Immer als passiver Inhalt: nosniff + Sandbox-CSP. */
  app.get("/api/code/raw", async (req, reply) => {
    const q = req.query as { path?: string; rev?: string; download?: string };
    if (!q.path) return reply.code(400).send({ error: "path required" });
    const t = await target(req, reply);
    if (!t) return;
    const file = await resolveFile(t.root, q.path);
    if (!file) return reply.code(404).send({ error: "file not found, not a regular file, or outside the workspace" });
    if (q.rev && q.rev !== file.revision) return reply.code(409).send({ error: "Die Datei hat sich geändert — neu laden.", revision: file.revision });
    const { mime, family } = mimeOf(file.rel);
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
    let start = 0;
    let end = file.size - 1;
    if (range) {
      if (range[1] !== "") {
        start = Number(range[1]);
        if (range[2] !== "") end = Math.min(Number(range[2]), file.size - 1);
      } else if (range[2] !== "") {
        start = Math.max(file.size - Number(range[2]), 0);
      }
      if (start > end || start >= file.size) return reply.code(416).header("content-range", `bytes */${file.size}`).send();
    }
    reply
      .code(range ? 206 : 200)
      .header("accept-ranges", "bytes")
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'")
      .header("etag", `"${file.revision}"`)
      .header("content-length", String(file.size === 0 ? 0 : end - start + 1))
      .header("content-type", q.download === "1" || (family === null && mime === "application/octet-stream") ? "application/octet-stream" : mime)
      .header("content-disposition", `${q.download === "1" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(basename(file.rel))}`);
    if (range) reply.header("content-range", `bytes ${start}-${end}/${file.size}`);
    return reply.send(file.size === 0 ? Buffer.alloc(0) : createReadStream(file.real, { start, end }));
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
