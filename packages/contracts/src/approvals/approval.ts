import { z } from "zod";
import { ToolAssessment } from "./gatekeeper.ts";

/**
 * Approval-Klassen/Contract (ADR-0007, T2.4/EPIC-P2 §3).
 *
 * `read` never produces an ApprovalRequest at all — it's free by
 * definition (EPIC-P2's class table). `write` and `destructive` do.
 * `destructive` decisions are honestly refused by ApprovalService until
 * T2.5 wires a real WebAuthn assertion signature — see ADR-0007.
 */
export const APPROVAL_CLASSES = ["read", "write", "destructive"] as const;
export const ApprovalClass = z.enum(APPROVAL_CLASSES);
export type ApprovalClass = (typeof APPROVAL_CLASSES)[number];

export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "timed_out"] as const;
export const ApprovalStatus = z.enum(APPROVAL_STATUSES);
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const ApprovalRequest = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  class: ApprovalClass,
  /** Free string naming the gated action, e.g. "steer.prompt". */
  action: z.string().min(1),
  /** Human-readable "what/where/model/budget" summary (EPIC-P2 §3). */
  summary: z.string().min(1),
  createdAt: z.string().min(1),
  timeoutAt: z.string().min(1),
  status: ApprovalStatus,
  reasonRequired: z.boolean(),
  reason: z.string().nullable(),
  decidedAt: z.string().nullable(),
  /** Device-token label (e.g. "pixel-9"), never the token or its hash. */
  decidedByLabel: z.string().nullable(),
  /** HMAC-SHA256(raw device token, canonical decision payload) for
   * `write`; a real WebAuthn assertion signature for `destructive`
   * (T2.5). Null while `pending`. See ADR-0007 for why this isn't a
   * dressed-up boolean. */
  signature: z.string().nullable(),
  /** T7.3: sha256 of the exact arguments this approval releases (the
   * pending operation's payload) — part of the signed decision. Null for
   * approvals without an operation. */
  payloadHash: z.string().nullable().optional(),
  /** T7.9: the gatekeeper's view of a tool request (never a decision). */
  assessment: ToolAssessment.nullable().optional(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequest>;

export const DecideApprovalInput = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().min(1).optional(),
  /** T7.2: answers to a provider question, keyed by the question text. */
  answers: z.record(z.string(), z.string().max(2000)).optional(),
});
export type DecideApprovalInput = z.infer<typeof DecideApprovalInput>;
