import type { FastifyInstance } from "fastify";
import { extractToken } from "../../platform/auth.ts";
import { DecideApprovalInput, ApprovalStatus } from "@uacc/contracts";
import { z } from "zod";
import type { RouteContext } from "../../route-context.ts";

/** Approval queue and decisions, signed or by passkey (ADR-0007, ADR-0019). */
export function registerApprovalsRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps, callerLabel, webauthnRoutes } = ctx;

  // T2.4/T2.6 (EPIC-P2 §3 "Approval-Queue"): a hub that hasn't configured
  // an ApprovalService yet doesn't get these routes — a real 501, not a
  // silently missing feature the PWA would otherwise 404 into.
  app.get("/api/approvals", async (req, reply) => {
    if (!deps.approvals) return reply.code(501).send({ error: "approval queue not configured" });
    const q = req.query as { status?: string };
    const status = ApprovalStatus.safeParse(q.status);
    // T7.3: what the decision released, and what became of it.
    return deps.approvals.list(status.success ? status.data : undefined).map((r) => {
      const op = deps.sessions.operation(r.id);
      if (!op) return r;
      const operation = { state: op.state, outcome: op.outcome };
      if (op.kind !== "tool.permission") return { ...r, operation };
      // T7.2: what the provider wants to run, or what it asks.
      const { toolName, input } = op.payload as { toolName: string; input: Record<string, unknown> };
      const questions = Array.isArray(input.questions) ? input.questions : undefined;
      const shown = JSON.stringify(input);
      return {
        ...r,
        operation,
        tool: { name: toolName, input: shown.length > 2000 ? `${shown.slice(0, 1999)}…` : shown, ...(questions ? { questions } : {}) },
      };
    });
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
    // T7.2: a provider question needs its answer before it can be released.
    const pendingRequest = deps.approvals.get(id);
    if (pendingRequest?.action === "tool.question" && parsed.data.decision === "approve") {
      const answers = parsed.data.answers ?? {};
      if (Object.keys(answers).length === 0) return reply.code(422).send({ ok: false, detail: "Antwort fehlt." });
      if (!deps.sessions.answerToolQuestion(id, answers)) return reply.code(422).send({ ok: false, detail: "Rückfrage ist nicht mehr offen." });
    }
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
    } else if (result.request!.status === "approved" && ["session.create", "session.stop", "session.park"].includes(result.request!.action)) {
      // T7.4: an agent's request, released by this human.
      await deps.sessions.applyApproved(result.request!.id, identity.label).catch((err) => {
        req.log.error({ err }, "applyApproved failed after a real approval");
      });
    } else if (result.request!.status === "approved" && result.request!.action === "budget.increase") {
      await deps.sessions.applyApprovedBudgetTopUp(result.request!.id, identity.label).catch((err) => {
        req.log.error({ err }, "applyApprovedBudgetTopUp failed after a real approval");
      });
    }
    return result.request;
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
    response: z.record(z.string(), z.unknown()),
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
}
