import type { Ack, AdapterContext, PendingOperation, PromptAttachment, SteerInput } from "@uacc/contracts";
import type { ApprovalService, OperationStore } from "../approvals/index.ts";
import type { LiveSession } from "./session-state.ts";

/** What the approval flow may do with a session — nothing more (ADR-0020). */
export interface ApprovalFlowHost {
  session(id: string): LiveSession | undefined;
  emitSystem(session: LiveSession, kind: string, payload: Record<string, unknown>): Promise<void>;
  emitPrompt(session: LiveSession, text: string, actor?: string, attachments?: readonly PromptAttachment[]): Promise<void>;
  /** T7.10: attachments as the session's harness takes them. */
  forAdapter<T extends { text: string; attachments?: PromptAttachment[] | undefined }>(session: LiveSession, input: T): T;
  continueStopped(session: LiveSession, input: Extract<SteerInput, { kind: "prompt" }>, actor?: string): Promise<Ack>;
  context(session: LiveSession): AdapterContext;
  applyBudgetTopUp(sessionId: string, newBudgetUsd: number, actor?: string): Promise<Ack>;
  /** T7.4: what an agent's approved request finally runs. */
  createSession(spec: unknown, actor?: string): Promise<{ id: string }>;
  stopSession(sessionId: string, actor?: string): Promise<Ack>;
  parkSession(sessionId: string, actor?: string): Promise<Ack>;
}

/** T7.4: requests an agent may make — each waits for a human. */
export type AgentActionKind = "session.create" | "session.stop" | "session.park" | "steer.prompt" | "budget.increase";

/**
 * ADR-0007/ADR-0019: prompts and budget top-ups that wait for a human
 * decision, run at most once afterwards, and are reconciled after a restart.
 */
export class ApprovalFlow {
  private readonly host: ApprovalFlowHost;
  private readonly approvals: ApprovalService | undefined;
  /** T7.4: always present on a real hub (independent of requireStepApprovals). */
  private humanGate: ApprovalService | undefined;
  private readonly operations: OperationStore;

  constructor(host: ApprovalFlowHost, approvals: ApprovalService | undefined, operations: OperationStore) {
    this.host = host;
    this.approvals = approvals;
    this.operations = operations;
  }

  /** T7.4: the approval queue for agent requests. */
  useHumanGate(approvals: ApprovalService): void {
    this.humanGate = approvals;
  }

  /**
   * T7.4: an agent (MCP gateway) asks to create, prompt, park or stop a
   * session. Never runs directly — a human decides in the queue; the
   * approved request runs once (ADR-0019).
   */
  async requestAgentAction(kind: AgentActionKind, sessionId: string | null, payload: Record<string, unknown>, actor: string): Promise<Ack & { approvalId?: string }> {
    const gate = this.humanGate ?? this.approvals;
    if (!gate) return { ok: false, detail: "Keine Freigabe-Warteschlange — Agenten dürfen hier nichts ändern." };
    const summary =
      kind === "session.create"
        ? `${actor} möchte eine Session starten: ${String(payload.adapter)} in ${String(payload.project).split("/").pop()}${payload.prompt ? ` — "${String(payload.prompt).slice(0, 120)}"` : ""}`
        : kind === "steer.prompt"
          ? `${actor} möchte einen Prompt senden: "${String((payload.input as { text?: string })?.text ?? "").slice(0, 160)}"`
          : kind === "budget.increase"
            ? `${actor} möchte das Budget auf ${Number(payload.newBudgetUsd).toFixed(2)}$ erhöhen${payload.reason ? ` (${String(payload.reason)})` : ""}`
            : `${actor} möchte die Session ${kind === "session.stop" ? "stoppen" : "anhalten"}`;
    const req = gate.create(sessionId ?? "neu", "write", kind, summary);
    this.operations.create(req.id, sessionId ?? "neu", kind, payload, 0, actor);
    const session = sessionId ? this.host.session(sessionId) : undefined;
    if (session) await this.host.emitSystem(session, "session.agent_request", { approvalId: req.id, action: kind, actor });
    return { ok: false, detail: `pending approval ${req.id}`, approvalId: req.id };
  }

  /** T7.4: runs whatever an approval released (the decide route calls this). */
  async applyApproved(approvalId: string, decidedByLabel?: string): Promise<Ack> {
    const op = this.operations.get(approvalId);
    if (!op) return { ok: false, detail: "no pending operation for this approval" };
    return this.dispatchOperation(op, decidedByLabel);
  }

  /** Parks a prompt behind an approval when the hub requires one; null
   * when it may go straight to the provider. */
  async gateSteer(session: LiveSession, input: SteerInput, delivered: SteerInput, actor?: string): Promise<Ack | null> {
    // T2.4/ADR-0007: "Steer-Prompt" is explicitly a write-class action
    // (EPIC-P2 §3 table) once an ApprovalService is configured — parked,
    // not forwarded, until a real approval decision comes back through
    // applyApprovedSteer(). `stop`/`park`/`resume` stay ungated: EPIC-P2's
    // class table lists commit/session-start/steer-prompt as the
    // write-class examples, not "make the agent stop".
    if (!this.approvals || input.kind !== "prompt" || delivered.kind !== "prompt") return null;
    const req = this.approvals.create(
      session.record.id,
      "write",
      "steer.prompt",
      `Prompt an ${session.record.adapter} senden: "${input.text.slice(0, 160)}"`,
    );
    this.operations.create(req.id, session.record.id, "steer.prompt", { input: delivered, typed: input.text }, session.record.inputRevision, actor ?? null);
    await this.host.emitSystem(session, "session.steer_pending_approval", { approvalId: req.id, actor: actor ?? null });
    return { ok: false, detail: `pending approval ${req.id}` };
  }

  /**
   * T2.4: the one place a write-class steer actually reaches the adapter
   * once approved — called by the /api/approvals/:id/decide route right
   * after ApprovalService.decide() reports a genuine "approved" (never
   * called speculatively, never called for a rejection). A missing entry
   * (unknown approvalId, or the session ended while the approval sat
   * pending) is a real, nameable outcome, not a crash.
   */
  async applyApprovedSteer(approvalId: string, decidedByLabel?: string): Promise<Ack> {
    const op = this.operations.get(approvalId);
    if (!op || op.kind !== "steer.prompt") return { ok: false, detail: "no pending steer for this approval" };
    return this.dispatchOperation(op, decidedByLabel);
  }
  /**
   * T7.3: runs an approved operation at most once. `pending → dispatching`
   * is one conditional UPDATE, so a second caller (a retried decide, the
   * catch-up after a restart) finds it taken. Arguments are checked
   * against the approved hash right before running.
   */
  private async dispatchOperation(op: PendingOperation, decidedByLabel?: string): Promise<Ack> {
    if (op.kind === "session.create") return this.dispatchCreate(op, decidedByLabel);
    const session = this.host.session(op.sessionId);
    if (!session) {
      this.operations.transition(op.id, ["pending"], "failed", "Die Session ist nicht mehr aktiv.");
      return { ok: false, detail: "session not live" };
    }
    if (!this.operations.intact(op)) {
      this.operations.transition(op.id, ["pending"], "failed", "Die Argumente weichen von der Freigabe ab.");
      await this.host.emitSystem(session, "operation.rejected_changed", { operationId: op.id, kind: op.kind });
      return { ok: false, detail: "operation arguments changed after approval" };
    }
    if (!this.operations.transition(op.id, ["pending"], "dispatching")) {
      return { ok: false, detail: `operation already ${this.operations.get(op.id)?.state ?? "gone"}` };
    }
    let ack: Ack;
    try {
      if (op.kind === "steer.prompt") {
        const { input, typed } = op.payload as { input: SteerInput; typed?: string };
        ack = await this.runApprovedSteer(session, input, typed, op.id, decidedByLabel);
      } else if (op.kind === "session.stop") {
        ack = await this.host.stopSession(op.sessionId, decidedByLabel);
      } else if (op.kind === "session.park") {
        ack = await this.host.parkSession(op.sessionId, decidedByLabel);
      } else if (op.kind === "budget.increase") {
        const { newBudgetUsd } = op.payload as { newBudgetUsd: number };
        ack = await this.host.applyBudgetTopUp(op.sessionId, newBudgetUsd, decidedByLabel);
      } else {
        ack = { ok: false, detail: `no dispatcher for ${op.kind}` };
      }
    } catch (err) {
      ack = { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
    this.operations.transition(op.id, ["dispatching"], ack.ok ? "done" : "failed", ack.ok ? "ausgeführt" : (ack.detail ?? "fehlgeschlagen"));
    return ack;
  }
  /** T7.4: an agent's session start, approved — runs once. */
  private async dispatchCreate(op: PendingOperation, decidedByLabel?: string): Promise<Ack> {
    if (!this.operations.intact(op)) {
      this.operations.transition(op.id, ["pending"], "failed", "Die Argumente weichen von der Freigabe ab.");
      return { ok: false, detail: "operation arguments changed after approval" };
    }
    if (!this.operations.transition(op.id, ["pending"], "dispatching")) {
      return { ok: false, detail: `operation already ${this.operations.get(op.id)?.state ?? "gone"}` };
    }
    try {
      const created = await this.host.createSession(op.payload, `${op.actor ?? "agent"} (freigegeben von ${decidedByLabel ?? "?"})`);
      this.operations.transition(op.id, ["dispatching"], "done", `Session ${created.id}`);
      return { ok: true, detail: created.id };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.operations.transition(op.id, ["dispatching"], "failed", detail);
      return { ok: false, detail };
    }
  }

  private async runApprovedSteer(session: LiveSession, input: SteerInput, typed: string | undefined, approvalId: string, decidedByLabel?: string): Promise<Ack> {
    if (input.kind === "prompt") await this.host.emitPrompt(session, typed ?? input.text, decidedByLabel, input.attachments);
    if (input.kind === "prompt") input = this.host.forAdapter(session, input);
    if (input.kind === "prompt" && (session.record.status === "stopped" || !session.handle)) {
      return this.host.continueStopped(session, input, decidedByLabel);
    }
    if (!session.handle) return { ok: false, detail: "session not live" };
    const ack = await session.adapter.steer(session.handle, input, this.host.context(session));
    await this.host.emitSystem(session, "session.steer", {
      steerKind: input.kind,
      ok: ack.ok,
      approvalId,
      actor: decidedByLabel ?? null,
      ...(ack.ok ? {} : { detail: ack.detail ?? null }),
    });
    return ack;
  }
  /**
   * Requests a budget change for a session — EPIC-P2 §3 lists "Budget-
   * Änderung" as a write-class action requiring a reason. Applied
   * immediately only when no ApprovalService is configured (same opt-in
   * pattern as steer()); otherwise parked as a pending approval and only
   * actually applied by applyApprovedBudgetTopUp() once approved.
   */
  async requestBudgetTopUp(
    sessionId: string,
    newBudgetUsd: number,
    reason?: string,
    actor?: string,
  ): Promise<Ack & { approvalId?: string }> {
    const session = this.host.session(sessionId);
    if (!session) return { ok: false, detail: "session not live" };
    if (!this.approvals) {
      await this.host.applyBudgetTopUp(sessionId, newBudgetUsd, actor);
      return { ok: true };
    }
    const req = this.approvals.create(
      sessionId,
      "write",
      "budget.increase",
      `Budget auf ${newBudgetUsd.toFixed(2)}$ erhöhen${reason ? ` (${reason})` : ""}`,
      true, // ADR-0007: a budget change always requires a reason, unlike a plain steer prompt
    );
    this.operations.create(req.id, sessionId, "budget.increase", { newBudgetUsd, reason: reason ?? null }, session.record.inputRevision, actor ?? null);
    await this.host.emitSystem(session, "session.budget_topup_pending_approval", {
      approvalId: req.id,
      newBudgetUsd,
      actor: actor ?? null,
    });
    return { ok: false, detail: `pending approval ${req.id}`, approvalId: req.id };
  }
  /**
   * T2.8 (EPIC-P2 §2 "Audit-Trail … inkl. verweigerter Aktionen"): unlike
   * applyApprovedSteer/applyApprovedBudgetTopUp (which only ever run on a
   * genuine approval), this records EVERY decision — approved or
   * rejected, write or destructive — onto the session's own tail. Without
   * this, a rejected request only ever showed up in the separate
   * approvals table; a reviewer reading one session's history alone
   * couldn't see that an action was even requested and denied.
   */
  async recordApprovalDecision(
    sessionId: string,
    approvalId: string,
    action: string,
    status: "approved" | "rejected",
    decidedByLabel: string,
  ): Promise<void> {
    // A tool request (T7.2) is settled when its answer reaches the provider
    // (ToolPermissions.poll), not here — that is where the session goes back
    // to work.
    if (status === "rejected" && this.operations.get(approvalId)?.kind !== "tool.permission") {
      this.operations.transition(approvalId, ["pending"], "rejected", `abgelehnt von ${decidedByLabel}`);
    }
    const session = this.host.session(sessionId);
    if (!session) return; // session ended while the approval sat pending — nothing to record onto
    await this.host.emitSystem(session, "session.approval_decided", { approvalId, action, status, actor: decidedByLabel });
  }
  /** Called by the decide route once a `budget.increase` approval is
   * genuinely approved — mirrors applyApprovedSteer. */
  async applyApprovedBudgetTopUp(approvalId: string, decidedByLabel?: string): Promise<Ack> {
    const op = this.operations.get(approvalId);
    if (!op || op.kind !== "budget.increase") return { ok: false, detail: "no pending budget top-up for this approval" };
    return this.dispatchOperation(op, decidedByLabel);
  }
  /**
   * T7.3 / AC-P7-3, after a restart:
   * - still undecided → stays pending, decidable as before;
   * - decided "approved" but never started (crash between decision and
   *   dispatch) → runs now, once;
   * - rejected/timed out meanwhile → recorded so;
   * - was running when the hub died → `uncertain`, visible, never re-run:
   *   whether the provider already acted is unknown.
   */
  async reconcile(): Promise<void> {
    for (const op of this.operations.list(["dispatching"])) {
      this.operations.transition(op.id, ["dispatching"], "uncertain", "Der Hub wurde während der Ausführung neu gestartet. Ob sie ankam, ist unklar.");
      const session = this.host.session(op.sessionId);
      if (session) await this.host.emitSystem(session, "operation.uncertain", { operationId: op.id, operationKind: op.kind });
    }
    if (!this.approvals) return;
    for (const op of this.operations.list(["pending"])) {
      const decision = this.approvals.get(op.id);
      if (!decision) continue;
      if (decision.status === "approved") {
        const session = this.host.session(op.sessionId);
        if (session) await this.host.emitSystem(session, "operation.resumed", { operationId: op.id, operationKind: op.kind });
        await this.dispatchOperation(op, decision.decidedByLabel ?? undefined).catch(() => undefined);
      } else if (decision.status === "rejected" || decision.status === "timed_out") {
        this.operations.transition(op.id, ["pending"], decision.status);
      }
    }
  }
  /** T7.3: an action's current state, for the approval card and the API. */
  operation(id: string): PendingOperation | undefined {
    const op = this.operations.get(id);
    if (op?.state === "pending" && this.approvals) {
      const status = this.approvals.get(id)?.status;
      if (status === "rejected" || status === "timed_out") {
        this.operations.transition(id, ["pending"], status);
        return this.operations.get(id);
      }
    }
    return op;
  }}
