import type { FastifyInstance, FastifyRequest } from "fastify";
import type { SessionManager, TokenService, AdapterRegistry, ApprovalService, WebAuthnStore } from "@uacc/core";
import { discoverProjects, isProjectPathAllowed, scanProjectSkills } from "@uacc/core";
import { enhancePrompt } from "./enhance.ts";
import { getSessionDiff, getSessionFileHunks } from "./diff.ts";
import { extractToken } from "./auth.ts";
import { createWebAuthnRoutes, type WebAuthnConfig } from "./webauthn.ts";
import { appendOptimizerFeedback } from "./prompt-optimizer-feedback.ts";
import { ensureIndexed, indexStatus, isQmdAvailable, readProjectFile, relativeDataDir, searchProject } from "./search.ts";
import { DecideApprovalInput, ApprovalStatus, ENV_VAR_NAME } from "@uacc/contracts";
import { z } from "zod";

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
  costUsd: z.number().optional(),
  latencyMs: z.number(),
});

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

const SteerBody = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("prompt"), text: z.string().min(1) }),
  z.object({ kind: z.literal("stop") }),
  z.object({ kind: z.literal("park") }),
  z.object({ kind: z.literal("resume") }),
]);

export function registerRoutes(
  app: FastifyInstance,
  deps: {
    sessions: SessionManager;
    tokens: TokenService;
    registry: AdapterRegistry;
    projectRoots?: string[];
    /** T2.4/EPIC-P2: optional, like SessionManager's worktrees/approvals
     * wiring — a hub without an ApprovalService configured just doesn't
     * expose the queue routes (501, not a crash). */
    approvals?: ApprovalService;
    /** T2.5: optional — a hub without WebAuthn configured doesn't expose
     * the passkey routes (501), same pattern as approvals above. */
    webauthn?: { store: WebAuthnStore; config: WebAuthnConfig };
    /** T3.9: optional — omitting it disables POST /api/prompt-optimizer/
     * feedback (501), same pattern as above. */
    dataDir?: string;
  },
): void {
  const projectRoots = deps.projectRoots ?? [];
  const webauthnRoutes = deps.webauthn ? createWebAuthnRoutes(deps.webauthn.store, deps.webauthn.config) : null;
  // T3.8: dedup concurrent ensureIndexed() calls for the same project — a
  // first-time index can take real minutes; without this, rapid repeated
  // searches while indexing would each kick off their own `qmd embed`.
  const indexingInFlight = new Map<string, Promise<void>>();
  // T2.8 (EPIC-P2 §2 audit trail "wer-wann-was"): the caller's own device
  // label, identify()d fresh from its already-authHook-verified bearer
  // token on every call — never trusted from anything client-supplied.
  function callerLabel(req: FastifyRequest): string | null {
    const raw = extractToken(req);
    if (!raw) return null;
    return deps.tokens.identify(raw)?.label ?? null;
  }

  app.get("/api/health", async () => ({
    ok: true,
    adapters: deps.registry.list().map((a) => ({
      id: a.id,
      version: a.adapter.version,
      capabilities: a.capabilities,
      module: a.module,
    })),
    serverTime: new Date().toISOString(),
  }));

  app.get("/api/adapters", async () =>
    deps.registry.list().map((a) => ({
      id: a.id,
      version: a.adapter.version,
      capabilities: a.capabilities,
    })),
  );

  app.get("/api/adapters/:id/usage", async (req, reply) => {
    // ADR-0004: account-level usage/quota, not session-scoped. `usage`
    // reflects capabilities().usage — false means "verified absent for
    // this adapter" (e.g. codex), never guessed as 0%. `snapshot` is null
    // whenever this adapter hasn't emitted one yet, distinct from "0%
    // used": a session that only just started may not have seen one.
    const { id } = req.params as { id: string };
    const registered = deps.registry.list().find((a) => a.id === id);
    if (!registered) return reply.code(404).send({ error: "unknown adapter" });
    const snapshot = deps.sessions.getAdapterUsage(id);
    return {
      adapterId: id,
      supported: registered.capabilities.usage,
      quota: snapshot?.quota ?? null,
      observedAt: snapshot?.observedAt ?? null,
    };
  });

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
      return await enhancePrompt(parsed.data.adapter, parsed.data.text, parsed.data.project);
    } catch (err) {
      return reply.code(502).send({
        error: err instanceof Error ? err.message : "prompt enhancement failed",
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
    const { costUsd, ...rest } = parsed.data;
    await appendOptimizerFeedback(deps.dataDir, { ...rest, ...(costUsd !== undefined ? { costUsd } : {}) });
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
    const items = await scanProjectSkills(q.project);
    return { items };
  });

  app.get("/api/projects", async () => {
    // T1.5-4: fresh scan on every call (not cached at startup) — a repo
    // cloned after the hub started should show up without a restart.
    // Startup-time readability warnings are logged once in createHubApp();
    // this response carries them again so a client can surface them too.
    const { projects, warnings } = await discoverProjects(projectRoots);
    return { projects, warnings };
  });

  app.get("/api/sessions", async () => deps.sessions.list());

  app.get("/api/sessions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = deps.sessions.get(id);
    if (!session) return reply.code(404).send({ error: "unknown session" });
    return session;
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
      const record = await deps.sessions.create(parsed.data, callerLabel(req) ?? undefined);
      return reply.code(201).send(record);
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
    const ack = await deps.sessions.steer(id, parsed.data, callerLabel(req) ?? undefined);
    return ack.ok ? ack : reply.code(422).send(ack);
  });

  app.post("/api/sessions/:id/stop", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ack = await deps.sessions.stop(id, callerLabel(req) ?? undefined);
    return ack.ok ? ack : reply.code(422).send(ack);
  });

  app.get("/api/tokens", async () => deps.tokens.list());

  app.post("/api/tokens", async (req, reply) => {
    const body = z.object({ label: z.string().min(1) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "label required" });
    return reply.code(201).send(deps.tokens.issue(body.data.label));
  });

  app.delete("/api/tokens/:label", async (req, _reply) => {
    const { label } = req.params as { label: string };
    const revoked = deps.tokens.revoke(label);
    return { revoked };
  });

  // T2.4/T2.6 (EPIC-P2 §3 "Approval-Queue"): a hub that hasn't configured
  // an ApprovalService yet doesn't get these routes — a real 501, not a
  // silently missing feature the PWA would otherwise 404 into.
  app.get("/api/approvals", async (req, reply) => {
    if (!deps.approvals) return reply.code(501).send({ error: "approval queue not configured" });
    const q = req.query as { status?: string };
    const status = ApprovalStatus.safeParse(q.status);
    return deps.approvals.list(status.success ? status.data : undefined);
  });

  app.get("/api/approvals/:id", async (req, reply) => {
    if (!deps.approvals) return reply.code(501).send({ error: "approval queue not configured" });
    const { id } = req.params as { id: string };
    const found = deps.approvals.get(id);
    if (!found) return reply.code(404).send({ error: "unknown approval" });
    return found;
  });

  app.post("/api/approvals/:id/decide", async (req, reply) => {
    if (!deps.approvals) return reply.code(501).send({ error: "approval queue not configured" });
    const { id } = req.params as { id: string };
    const parsed = DecideApprovalInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid decision" });
    // AC-P2-5/ADR-0007: the signature proves possession of THIS caller's
    // already-verified bearer token — never the session-record's own
    // project path or anything client-supplied, so there is no way to
    // "sign" a decision without the credential authHook already required.
    const rawToken = extractToken(req);
    if (!rawToken) return reply.code(401).send({ error: "missing device token" });
    const identity = deps.tokens.identify(rawToken);
    if (!identity) return reply.code(401).send({ error: "invalid device token" });
    const result = deps.approvals.decide(id, parsed.data.decision, rawToken, identity.label, parsed.data.reason);
    if (!result.ok) return reply.code(422).send(result);
    // T2.8: every genuine decision (approved OR rejected) is recorded
    // onto the session's own tail, not just the separate approvals table
    // — a reviewer reading one session's history must see that an action
    // was requested and denied, not just its silent absence.
    await deps.sessions
      .recordApprovalDecision(result.request!.sessionId, result.request!.id, result.request!.action, result.request!.status as "approved" | "rejected", identity.label)
      .catch((err) => {
        req.log.error({ err }, "recordApprovalDecision failed after a real decision");
      });
    // T2.4/T2.7's ADR-0007 integration point: an approved write-class
    // steer or budget top-up gets actually applied now — see
    // SessionManager.applyApprovedSteer/applyApprovedBudgetTopUp's own
    // doc comments for why this is the one place either call happens.
    if (result.request!.status === "approved" && result.request!.action === "steer.prompt") {
      await deps.sessions.applyApprovedSteer(result.request!.id, identity.label).catch((err) => {
        req.log.error({ err }, "applyApprovedSteer failed after a real approval");
      });
    } else if (result.request!.status === "approved" && result.request!.action === "budget.increase") {
      await deps.sessions.applyApprovedBudgetTopUp(result.request!.id, identity.label).catch((err) => {
        req.log.error({ err }, "applyApprovedBudgetTopUp failed after a real approval");
      });
    }
    return result.request;
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

  // T2.5 (EPIC-P2 §3): WebAuthn passkey registration + the biometric
  // decide path for `destructive` approvals. Identity is always the
  // caller's own bearer device token (identify()d fresh each call) — a
  // device can only ever register/use a passkey for itself, never for
  // another device's label.
  app.get("/api/webauthn/status", async (req, reply) => {
    if (!webauthnRoutes) return reply.code(501).send({ error: "webauthn not configured" });
    const label = callerLabel(req);
    if (!label) return reply.code(401).send({ error: "invalid device token" });
    return { registered: deps.webauthn!.store.getCredential(label) !== undefined };
  });

  app.post("/api/webauthn/register/options", async (req, reply) => {
    if (!webauthnRoutes) return reply.code(501).send({ error: "webauthn not configured" });
    const label = callerLabel(req);
    if (!label) return reply.code(401).send({ error: "invalid device token" });
    return webauthnRoutes.registerOptions(label);
  });

  app.post("/api/webauthn/register/verify", async (req, reply) => {
    if (!webauthnRoutes) return reply.code(501).send({ error: "webauthn not configured" });
    const label = callerLabel(req);
    if (!label) return reply.code(401).send({ error: "invalid device token" });
    const result = await webauthnRoutes.registerVerify(label, req.body as never);
    return result.ok ? result : reply.code(422).send(result);
  });

  app.post("/api/approvals/:id/webauthn/assert-options", async (req, reply) => {
    if (!webauthnRoutes) return reply.code(501).send({ error: "webauthn not configured" });
    const label = callerLabel(req);
    if (!label) return reply.code(401).send({ error: "invalid device token" });
    const result = await webauthnRoutes.assertOptions(label);
    return result.ok ? result.options : reply.code(422).send(result);
  });

  const DecideBiometricBody = z.object({
    decision: z.enum(["approve", "reject"]),
    reason: z.string().min(1).optional(),
    response: z.record(z.unknown()),
  });

  app.post("/api/approvals/:id/webauthn/decide", async (req, reply) => {
    if (!webauthnRoutes || !deps.approvals) return reply.code(501).send({ error: "webauthn/approvals not configured" });
    const { id } = req.params as { id: string };
    const label = callerLabel(req);
    if (!label) return reply.code(401).send({ error: "invalid device token" });
    const parsed = DecideBiometricBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid biometric decision body" });
    const verified = await webauthnRoutes.assertVerify(label, parsed.data.response as never);
    if (!verified.ok) return reply.code(422).send(verified);
    const result = deps.approvals.decideBiometric(id, parsed.data.decision, verified.fingerprint, label, parsed.data.reason);
    if (!result.ok) return reply.code(422).send(result);
    // T2.8: same audit requirement as the write-class decide route above —
    // a destructive decision (approved or rejected) belongs on the
    // session's own tail too.
    await deps.sessions
      .recordApprovalDecision(result.request!.sessionId, result.request!.id, result.request!.action, result.request!.status as "approved" | "rejected", label)
      .catch((err) => {
        req.log.error({ err }, "recordApprovalDecision failed after a real biometric decision");
      });
    return result.request;
  });

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
