import type { EmittedEvent, SessionStatus, ToolPermissionAnswer, ToolPermissionPoll, ToolPermissionRequest, ToolQuestion } from "@uacc/contracts";
import { QUESTION_TOOLS, ToolQuestion as ToolQuestionSchema } from "@uacc/contracts";
import type { ApprovalService, OperationStore } from "../approvals/index.ts";
import type { LiveSession } from "./session-state.ts";

/** T7.2: how a provider's tool requests reach a human. */
export interface ToolGate {
  approvals: ApprovalService;
  /** How long a tool request waits for a decision (then: denied). */
  timeoutMs: number;
  /** Prepares the per-session MCP bridge (claude --permission-prompt-tool). */
  bridge?: (sessionId: string) => Promise<{ mcpConfigPath: string; toolName: string }>;
}

/** What tool permissions may do with a session — nothing more (ADR-0020). */
export interface ToolPermissionHost {
  session(id: string): LiveSession | undefined;
  setStatus(session: LiveSession, status: SessionStatus): Promise<void>;
  emitEvents(session: LiveSession, events: EmittedEvent[]): Promise<void>;
}

/** One line for the approval card: the command, path or first argument. */
export function describeToolInput(input: Record<string, unknown>): string {
  for (const key of ["command", "file_path", "path", "url", "pattern", "query"]) {
    const value = input[key];
    if (typeof value === "string" && value) return value.replace(/\s+/g, " ").slice(0, 240);
  }
  const json = JSON.stringify(input);
  return json.length > 240 ? `${json.slice(0, 239)}…` : json;
}

function readQuestions(input: Record<string, unknown>): ToolQuestion[] {
  const raw = Array.isArray(input.questions) ? input.questions : [];
  return raw.flatMap((q) => {
    const parsed = ToolQuestionSchema.safeParse(q);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * T7.2 / ADR-0018 §3: a provider asks before a tool runs (claude's
 * permission prompt tool; ACP's request_permission later). Each request is
 * an approval plus a `tool.permission` operation (ADR-0019), so it survives
 * a hub restart. Reject and timeout answer "deny" — the provider does not run
 * the tool.
 */
export class ToolPermissions {
  private readonly host: ToolPermissionHost;
  private readonly operations: OperationStore;
  private readonly gate: ToolGate;

  constructor(host: ToolPermissionHost, operations: OperationStore, gate: ToolGate) {
    this.host = host;
    this.operations = operations;
    this.gate = gate;
  }

  get bridge(): ToolGate["bridge"] {
    return this.gate.bridge;
  }

  /** A provider asks before running a tool. Idempotent per tool-use id. */
  async request(sessionId: string, req: ToolPermissionRequest): Promise<{ ok: true; id: string } | { ok: false; detail: string }> {
    const session = this.host.session(sessionId);
    if (!session) return { ok: false, detail: "session not live" };
    if (req.toolUseId) {
      const known = this.operations.findToolRequest(sessionId, req.toolUseId);
      if (known) return { ok: true, id: known.id };
    }
    const question = (QUESTION_TOOLS as readonly string[]).includes(req.toolName);
    const questions = question ? readQuestions(req.input) : [];
    const summary = question ? `Rückfrage: ${questions.map((q) => q.question).join(" / ")}` : `${req.toolName}: ${describeToolInput(req.input)}`;
    const approval = this.gate.approvals.create(sessionId, "write", question ? "tool.question" : `tool.${req.toolName}`, summary.slice(0, 300), false, this.gate.timeoutMs);
    this.operations.create(approval.id, sessionId, "tool.permission", { toolName: req.toolName, input: req.input, toolUseId: req.toolUseId ?? null }, session.record.inputRevision, session.record.adapter);
    if (session.record.status === "working" || session.record.status === "idle") await this.host.setStatus(session, "waiting_approval");
    await this.host.emitEvents(session, [
      {
        type: "gate",
        summary: summary.slice(0, 200),
        payload: { kind: "tool.permission_requested", approvalId: approval.id, toolName: req.toolName, question, ...(question ? { questions } : {}) },
      },
    ]);
    return { ok: true, id: approval.id };
  }

  /** The human's answers to a provider question — stored before the
   * approval is decided, handed to the provider with it. */
  answerQuestion(id: string, answers: Record<string, string>): boolean {
    const op = this.operations.get(id);
    if (!op || op.kind !== "tool.permission" || op.state !== "pending") return false;
    this.operations.setResponse(id, answers);
    return true;
  }

  /**
   * What the waiting provider gets. The first delivery settles the
   * operation and puts the session back to work; later polls (a bridge that
   * retried) get the same answer.
   */
  async poll(sessionId: string, id: string): Promise<ToolPermissionPoll | undefined> {
    const op = this.operations.get(id);
    if (!op || op.sessionId !== sessionId || op.kind !== "tool.permission") return undefined;
    const decision = this.gate.approvals.get(id);
    if (!decision) return undefined;
    if (decision.status === "pending") return { state: "pending", id };
    const { toolName, input } = op.payload as { toolName: string; input: Record<string, unknown> };
    let answer: ToolPermissionAnswer;
    if (decision.status === "approved" && !this.operations.intact(op)) {
      answer = { behavior: "deny", message: "Die Argumente weichen von der Freigabe ab — nicht ausgeführt." };
    } else if (decision.status === "approved") {
      const answers = this.operations.response(id);
      answer = { behavior: "allow", updatedInput: answers ? { ...input, answers } : input };
    } else if (decision.status === "rejected") {
      answer = { behavior: "deny", message: `Abgelehnt von ${decision.decidedByLabel ?? "Mensch"}${decision.reason ? `: ${decision.reason}` : ""}. Nicht ausführen.` };
    } else {
      const wait = this.gate.timeoutMs >= 60_000 ? `${Math.round(this.gate.timeoutMs / 60_000)} min` : `${Math.max(1, Math.round(this.gate.timeoutMs / 1000))} s`;
      answer = { behavior: "deny", message: `Keine Freigabe innerhalb von ${wait} — nicht ausgeführt.` };
    }
    const settled = answer.behavior === "allow" ? "done" : decision.status === "timed_out" ? "timed_out" : decision.status === "approved" ? "failed" : "rejected";
    if (this.operations.transition(id, ["pending"], settled, answer.behavior === "allow" ? "an den Provider übergeben" : answer.message)) {
      const session = this.host.session(sessionId);
      if (session) {
        if (session.record.status === "waiting_approval" && !this.operations.list(["pending"], sessionId).some((o) => o.kind === "tool.permission")) {
          await this.host.setStatus(session, "working");
        }
        await this.host.emitEvents(session, [
          {
            type: "gate",
            summary: `${toolName}: ${answer.behavior === "allow" ? "freigegeben" : decision.status === "timed_out" ? "Zeit abgelaufen, abgelehnt" : "abgelehnt"}`,
            payload: { kind: "tool.permission_answered", approvalId: id, toolName, behavior: answer.behavior, status: decision.status, actor: decision.decidedByLabel },
          },
        ]);
      }
    }
    return { state: "answered", id, answer };
  }
}
