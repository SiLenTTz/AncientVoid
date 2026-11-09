import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  commitsAhead,
  composeForgeFeedbackPrompt,
  currentBranch,
  encodeProjectId,
  fetchIssues,
  fetchJobs,
  fetchMr,
  fetchPipelines,
  fetchThreads,
  fetchTrace,
  findMrsBySourceBranch,
  GitLabApiError,
  headSha,
  parseMrUrl,
  parseRemoteUrl,
  pushBranch,
  remoteBranchSha,
  remoteUrl,
  resolveProject,
  shaDrifted,
  type GlabRunner,
} from "@ancientvoid/core";
import {
  CreateDraftMrInput,
  LinkMrInput,
  SendForgeFeedbackInput,
  type DraftMrPlan,
  type DraftMrResult,
  type ForgeMrRef,
} from "@ancientvoid/contracts";
import type { RouteContext } from "../../route-context.ts";

/**
 * EPIC-P37 / ADR-0056: Forge-Routen. GETs sind read-only gegenüber GitLab
 * (AC-P37-4); Mutationen (Verknüpfung, Feedback, Draft-MR) sind menschliche
 * Aktionen — Agenten-Tokens bekommen 403 (P36-Muster). Der Draft-MR-Pfad
 * pusht ausschließlich den Session-Branch und legt den MR über die API an —
 * niemals ein lokaler Merge nach main.
 */

const humanOnly = (req: { policy?: { decision?: string } }, reply: { code: (c: number) => { send: (b: unknown) => unknown } }, msg: string): unknown => {
  if (req.policy?.decision === "approve") return reply.code(403).send({ error: msg });
  return undefined;
};

const errDetail = (err: unknown): string => {
  if (err instanceof GitLabApiError) return `${err.kind}: ${err.message}`;
  return err instanceof Error ? err.message : "Unbekannter Fehler";
};

export function registerForgeRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps } = ctx;
  const forge = deps.forge;
  if (!forge) {
    app.get("/api/sessions/:id/forge/overview", async () => ({ error: "Forge ist auf diesem Hub nicht eingerichtet." }));
    return;
  }

  const workdirOf = (id: string): { workdir: string | null } => {
    const session = deps.sessions.get(id);
    if (!session) return { workdir: null };
    return { workdir: deps.sessions.workdirOf(id) ?? session.project };
  };

  const linkOf = (id: string): ForgeMrRef | null => forge.store.getLink(id)?.mr ?? null;

  /** Session-Kontext fürs Panel: Branch + Head des Workdirs (K7-Realität, nicht Cache). */
  app.get("/api/sessions/:id/forge/overview", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deps.sessions.get(id)) return reply.code(404).send({ error: "unknown session" });
    const link = forge.store.getLink(id);
    const { workdir } = workdirOf(id);
    const sessionBranch = workdir ? await currentBranch(workdir) : null;
    const sessionHead = workdir ? await headSha(workdir) : null;

    if (!link) return { link: null, sessionBranch, sessionHead, mr: null, pipelines: [], cachedAt: null, staleError: null, journalSkippedLines: forge.store.skippedLines(id) };

    try {
      const previousSha = link.lastSha;
      const entry = await forge.cached(`mr:${link.mr.host}/${link.mr.projectId}/${link.mr.mrIid}`, () => fetchMr(forge.run, link.mr));
      if (entry.staleError === null) forge.store.recordFetch(id, entry.data.sha);
      const pipelinesEntry = await forge.cached(`pipelines:${link.mr.host}/${link.mr.projectId}/${entry.data.sourceBranch}`, () => fetchPipelines(forge.run, link.mr, entry.data.sourceBranch));
      const freshLink = forge.store.getLink(id);
      return {
        link: freshLink,
        sessionBranch,
        sessionHead,
        mr: entry.data,
        pipelines: pipelinesEntry.data,
        pipelineStaleError: pipelinesEntry.staleError,
        cachedAt: entry.fetchedAt,
        staleError: entry.staleError,
        /** MR-Head hat sich seit dem letzten Blick geändert (§3.3) */
        shaDrift: entry.staleError === null && shaDrifted(entry.data.sha, previousSha),
        journalSkippedLines: forge.store.skippedLines(id),
      };
    } catch (err) {
      return reply.code(502).send({ error: errDetail(err), link, sessionBranch, sessionHead });
    }
  });

  app.post("/api/sessions/:id/forge/link", async (req, reply) => {
    if (humanOnly(req, reply, "Forge-Verknüpfungen macht ein Mensch.")) return;
    const { id } = req.params as { id: string };
    if (!deps.sessions.get(id)) return reply.code(404).send({ error: "unknown session" });
    const parsed = LinkMrInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid link input", issues: parsed.error.issues });
    try {
      let ref: ForgeMrRef;
      if (parsed.data.url) {
        const ident = parseMrUrl(parsed.data.url);
        const project = await resolveProject(forge.run, ident.projectPath);
        ref = { host: ident.host, projectId: project.projectId, projectPath: project.projectPath, mrIid: ident.mrIid };
      } else if (parsed.data.ref) {
        ref = parsed.data.ref;
      } else {
        return reply.code(400).send({ error: "url oder ref angeben" });
      }
      const mr = await fetchMr(forge.run, ref); // Existenz prüfen — kein blindes Verknüpfen
      forge.store.linkMr(id, mr.ref);
      forge.store.recordFetch(id, mr.sha);
      forge.invalidate(`pipelines:${ref.host}/${ref.projectId}`);
      return { link: forge.store.getLink(id) };
    } catch (err) {
      return reply.code(422).send({ error: errDetail(err) });
    }
  });

  app.delete("/api/sessions/:id/forge/link", async (req, reply) => {
    if (humanOnly(req, reply, "Forge-Verknüpfungen löst ein Mensch.")) return;
    const { id } = req.params as { id: string };
    const removed = forge.store.unlinkMr(id);
    return removed ? { ok: true } : reply.code(404).send({ error: "keine Verknüpfung" });
  });

  app.get("/api/sessions/:id/forge/jobs", async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { pipelineId?: string };
    const ref = linkOf(id);
    const pipelineId = Number(q.pipelineId);
    if (!ref || !Number.isFinite(pipelineId)) return reply.code(400).send({ error: "Verknüpfung und pipelineId nötig" });
    try {
      const entry = await forge.cached(`jobs:${ref.host}/${ref.projectId}/${pipelineId}`, () => fetchJobs(forge.run, ref, pipelineId));
      return { items: entry.data, cachedAt: entry.fetchedAt, staleError: entry.staleError };
    } catch (err) {
      return reply.code(502).send({ error: errDetail(err) });
    }
  });

  app.get("/api/sessions/:id/forge/threads", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ref = linkOf(id);
    if (!ref) return reply.code(400).send({ error: "keine Verknüpfung" });
    try {
      const entry = await forge.cached(`threads:${ref.host}/${ref.projectId}/${ref.mrIid}`, () => fetchThreads(forge.run, ref));
      return { items: entry.data.items, truncated: entry.data.truncated, cachedAt: entry.fetchedAt, staleError: entry.staleError };
    } catch (err) {
      return reply.code(502).send({ error: errDetail(err) });
    }
  });

  app.get("/api/sessions/:id/forge/trace", async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { jobId?: string; pipelineId?: string };
    const ref = linkOf(id);
    const jobId = Number(q.jobId);
    if (!ref || !Number.isFinite(jobId)) return reply.code(400).send({ error: "Verknüpfung und jobId nötig" });
    try {
      const view = await forge.traceView({
        sessionId: id,
        jobId,
        pipelineId: Number.isFinite(Number(q.pipelineId)) ? Number(q.pipelineId) : null,
        sha: forge.store.getLink(id)?.lastSha ?? null,
        fetch: () => fetchTrace(forge.run, ref, jobId),
      });
      return view;
    } catch (err) {
      return reply.code(502).send({ error: errDetail(err) });
    }
  });

  /** Issues des Projekt-Remotes — Quelle für neue Sessions (T37.3). */
  app.get("/api/sessions/:id/forge/issues", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { workdir } = workdirOf(id);
    const url = workdir ? await remoteUrl(workdir) : null;
    if (!url) return reply.code(422).send({ error: "Projekt hat kein origin-Remote" });
    try {
      const ident = parseRemoteUrl(url);
      const project = await resolveProject(forge.run, ident.projectPath);
      const entry = await forge.cached(`issues:${ident.host}/${project.projectId}`, () => fetchIssues(forge.run, ident.host, project.projectId, project.projectPath));
      return { host: ident.host, projectId: project.projectId, items: entry.data.items, truncated: entry.data.truncated, cachedAt: entry.fetchedAt, staleError: entry.staleError };
    } catch (err) {
      return reply.code(502).send({ error: errDetail(err) });
    }
  });

  const FeedbackPreviewInput = z.object({
    finding: z.string().min(1).max(8_000),
    pipelineId: z.number().int().positive().optional(),
    jobId: z.number().int().positive().optional(),
    threadId: z.string().min(1).max(200).optional(),
  });

  app.post("/api/sessions/:id/forge/feedback/preview", async (req, reply) => {
    if (humanOnly(req, reply, "Vorschau ist für Menschen.")) return;
    const { id } = req.params as { id: string };
    const parsed = FeedbackPreviewInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid feedback input", issues: parsed.error.issues });
    const link = forge.store.getLink(id);
    if (!link) return reply.code(400).send({ error: "keine Verknüpfung" });
    return { prompt: composeForgeFeedbackPrompt(parsed.data.finding, { host: link.mr.host, projectPath: link.mr.projectPath ?? null, mrIid: link.mr.mrIid, sha: link.lastSha, pipelineId: parsed.data.pipelineId ?? null, jobId: parsed.data.jobId ?? null, threadId: parsed.data.threadId ?? null, fetchedAt: link.lastFetchedAt }) };
  });

  app.post("/api/sessions/:id/forge/feedback", async (req, reply) => {
    if (humanOnly(req, reply, "Forge-Feedback versendet ein Mensch.")) return;
    const { id } = req.params as { id: string };
    if (!deps.sessions.get(id)) return reply.code(404).send({ error: "unknown session" });
    const parsed = SendForgeFeedbackInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid feedback input", issues: parsed.error.issues });
    const { operationId, finding, targetSessionId, ...sourceRef } = parsed.data;
    const link = forge.store.getLink(id);
    if (!link) return reply.code(422).send({ ok: false, detail: "keine MR-Verknüpfung — erst verknüpfen" });

    // SHA-Drift: gegen die frische externe Wahrheit, nicht den Cache (§3.3)
    let currentSha: string | null;
    try {
      currentSha = (await fetchMr(forge.run, link.mr)).sha;
    } catch (err) {
      return reply.code(502).send({ ok: false, detail: `MR nicht prüfbar: ${errDetail(err)}` });
    }
    if (shaDrifted(currentSha, link.lastSha)) {
      // Die Ansicht muss den neuen Stand sofort zeigen (sonst hält der 30-s-Cache den alten und „Ansicht aktualisieren“ läuft ins Leere).
      forge.invalidate(`mr:${link.mr.host}/${link.mr.projectId}/${link.mr.mrIid}`);
      forge.invalidate(`pipelines:${link.mr.host}/${link.mr.projectId}`);
      return reply.code(422).send({ ok: false, detail: `MR-SHA hat sich geändert (${(link.lastSha ?? "?").slice(0, 8)} → ${(currentSha ?? "?").slice(0, 8)}) — Ansicht aktualisieren und Befund prüfen` });
    }

    const target = targetSessionId ?? id;
    if (!deps.sessions.get(target)) return reply.code(404).send({ ok: false, detail: "Empfänger-Session unbekannt" });
    const prompt = composeForgeFeedbackPrompt(finding, {
      host: link.mr.host,
      projectPath: link.mr.projectPath ?? null,
      mrIid: link.mr.mrIid,
      sha: link.lastSha,
      pipelineId: sourceRef.pipelineId ?? null,
      jobId: sourceRef.jobId ?? null,
      threadId: sourceRef.threadId ?? null,
      fetchedAt: link.lastFetchedAt,
    });
    const ack = await deps.sessions.steer(target, { kind: "prompt", text: prompt }, ctx.callerLabel(req) ?? undefined, { inputId: operationId });
    forge.store.recordFeedback(id, { operationId, ok: ack.ok, detail: "detail" in ack && typeof ack.detail === "string" ? ack.detail : null, sha: link.lastSha, pipelineId: sourceRef.pipelineId ?? null, jobId: sourceRef.jobId ?? null });
    if (!ack.ok) return reply.code(422).send({ ok: false, detail: ack.detail ?? "Versand abgelehnt" });
    return { ok: true, prompt };
  });

  /** Read-only Plan — keinerlei Mutation vor der Bestätigung (ADR §9). */
  app.post("/api/sessions/:id/forge/mr/plan", async (req, reply) => {
    if (humanOnly(req, reply, "Draft-MR-Plan sieht ein Mensch.")) return;
    const { id } = req.params as { id: string };
    const session = deps.sessions.get(id);
    if (!session) return reply.code(404).send({ error: "unknown session" });
    const { workdir } = workdirOf(id);
    if (!workdir) return reply.code(422).send({ error: "kein Workdir" });
    const url = await remoteUrl(workdir);
    if (!url) return reply.code(422).send({ error: "Projekt hat kein origin-Remote" });
    try {
      const ident = parseRemoteUrl(url);
      const branch = (await currentBranch(workdir)) ?? `ancientvoid/${id}`;
      const base = session.worktreeSha ?? "origin/main";
      const ahead = await commitsAhead(workdir, base);
      const pushedSha = await remoteBranchSha(workdir, branch);
      const head = await headSha(workdir);
      const plan: DraftMrPlan = {
        branch,
        commitsAhead: ahead,
        pushNeeded: pushedSha !== head,
        host: ident.host,
        projectId: null,
        projectPath: ident.projectPath,
        targetBranch: "main",
        suggestedTitle: ahead[0]?.subject ?? session.title ?? `Session ${id.slice(0, 8)}`,
        sessionTitle: session.title ?? null,
      };
      return plan;
    } catch (err) {
      return reply.code(422).send({ error: errDetail(err) });
    }
  });

  app.post("/api/sessions/:id/forge/mr/create", async (req, reply) => {
    if (humanOnly(req, reply, "Draft-MR erstellt ein Mensch.")) return;
    const { id } = req.params as { id: string };
    const session = deps.sessions.get(id);
    if (!session) return reply.code(404).send({ error: "unknown session" });
    const parsed = CreateDraftMrInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid draft-mr input", issues: parsed.error.issues });
    const { operationId, title, description, targetBranch, push } = parsed.data;
    const { workdir } = workdirOf(id);
    if (!workdir) return reply.code(422).send({ error: "kein Workdir" });
    const url = await remoteUrl(workdir);
    if (!url) return reply.code(422).send({ error: "Projekt hat kein origin-Remote" });
    if (/[^a-zA-Z0-9._/-]/.test(targetBranch)) {
      return reply.code(422).send({ error: "ungültiger Zielbranch" });
    }
    const ident = parseRemoteUrl(url);
    const branch = (await currentBranch(workdir)) ?? `ancientvoid/${id}`;
    const sha = await headSha(workdir);

    const fail = (state: "failed" | "uncertain", detail: string, code = 422): DraftMrResult => {
      forge.store.recordDraftMr(id, { id: operationId, kind: "draft_mr", state, sha, pipelineId: null, jobId: null, detail });
      reply.code(code);
      return { ok: false, webUrl: null, detail, state };
    };

    forge.store.recordDraftMr(id, { id: operationId, kind: "draft_mr", state: "pending", sha, pipelineId: null, jobId: null, detail: null });

    try {
      const project = await resolveProject(forge.run, ident.projectPath);
      // Retry-Abgleich: existiert bereits ein MR für diesen Branch? (AC-P37-5)
      const existing = (await findMrsBySourceBranch(forge.run, { host: ident.host, projectId: project.projectId, projectPath: project.projectPath, mrIid: 0 }, branch))
        .find((mr) => mr.state === "opened");
      if (existing) {
        forge.store.recordDraftMr(id, { id: operationId, kind: "draft_mr", state: "done", sha, pipelineId: null, jobId: null, detail: `Bestehenden MR wiederverwendet: ${existing.webUrl}` });
        return { ok: true, webUrl: existing.webUrl, detail: "Es existierte bereits ein MR für diesen Branch — kein zweiter erstellt.", state: "done" };
      }
      if (push) {
        await pushBranch(workdir, branch); // nur refs/heads/<session-branch>, niemals main
      }
      const mr = await createMrViaApi(forge.run, { projectId: project.projectId, projectPath: project.projectPath, sourceBranch: branch, targetBranch, title: `Draft: ${title}`, description });
      forge.store.recordDraftMr(id, { id: operationId, kind: "draft_mr", state: "done", sha, pipelineId: null, jobId: null, detail: mr.webUrl });
      return { ok: true, webUrl: mr.webUrl, detail: null, state: "done" };
    } catch (err) {
      const kind = err instanceof GitLabApiError ? err.kind : null;
      if (kind === "network" || kind === "rate_limit") {
        return fail("uncertain", `Ausgang unklar (${errDetail(err)}) — erneuter Versuch mit derselben Operations-ID sucht zuerst nach einem bestehenden MR.`, 504);
      }
      return fail("failed", errDetail(err));
    }
  });

  app.get("/api/sessions/:id/forge/operations", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deps.sessions.get(id)) return reply.code(404).send({ error: "unknown session" });
    return { items: forge.store.listOperations(id), journalSkippedLines: forge.store.skippedLines(id) };
  });
}

/** MR-Anlage über glab api — Felder als argv, nie interpoliert (ADR §3). */
async function createMrViaApi(
  run: GlabRunner,
  args: { projectId: number; projectPath: string; sourceBranch: string; targetBranch: string; title: string; description: string },
): Promise<{ webUrl: string }> {
  const path = `projects/${encodeProjectId({ projectId: args.projectId, projectPath: args.projectPath })}/merge_requests`;
  const res = await run([
    path,
    "-X",
    "POST",
    "-f",
    `source_branch=${args.sourceBranch}`,
    "-f",
    `target_branch=${args.targetBranch}`,
    "-f",
    `title=${args.title}`,
    "-f",
    `description=${args.description.slice(0, 20_000)}`,
  ]);
  try {
    const parsed = JSON.parse(res.stdout) as { web_url?: string };
    if (!parsed.web_url) throw new Error("Antwort ohne web_url");
    return { webUrl: parsed.web_url };
  } catch {
    throw new GitLabApiError("parse", path, `MR-Anlage-Antwort unverständlich: ${res.stdout.slice(0, 160)}`);
  }
}
