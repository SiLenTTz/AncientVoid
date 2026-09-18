import { randomUUID, createHmac } from "node:crypto";
import type { ApprovalClass, ApprovalRequest, ApprovalStatus } from "@uacc/contracts";
import type { HubDatabase } from "./db.ts";

/**
 * T2.4 (EPIC-P2 §3/§4, ADR-0007): the approval class engine — signature,
 * timeout, reason-required validation. See ADR-0007 for why the `write`
 * signature is an HMAC over the caller's already-verified device token
 * rather than a bare boolean, and why `destructive` is refused outright
 * until T2.5 wires a real WebAuthn assertion in its place.
 */

const DEFAULT_TIMEOUT_MS = 60_000; // EPIC-P2 §5 AC-P2-6: "60 s konfigurierbar"

interface ApprovalRow {
  id: string;
  session_id: string;
  class: string;
  action: string;
  summary: string;
  created_at: string;
  timeout_at: string;
  status: string;
  reason_required: number;
  reason: string | null;
  decided_at: string | null;
  decided_by_label: string | null;
  signature: string | null;
}

function rowToRequest(row: ApprovalRow): ApprovalRequest {
  return {
    id: row.id,
    sessionId: row.session_id,
    class: row.class as ApprovalClass,
    action: row.action,
    summary: row.summary,
    createdAt: row.created_at,
    timeoutAt: row.timeout_at,
    status: row.status as ApprovalStatus,
    reasonRequired: row.reason_required === 1,
    reason: row.reason,
    decidedAt: row.decided_at,
    decidedByLabel: row.decided_by_label,
    signature: row.signature,
  };
}

export interface DecideResult {
  ok: boolean;
  detail?: string;
  request?: ApprovalRequest;
}

export class ApprovalService {
  private readonly db: HubDatabase;
  private readonly timeoutMs: number;

  constructor(db: HubDatabase, timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.db = db;
    this.timeoutMs = timeoutMs;
  }

  /**
   * `read`-class actions never call this — they're free (EPIC-P2 §3).
   * `destructive` always requires a reason regardless of `reasonRequired`
   * (EPIC-P2 §3 table); a `write` action can opt in per-call (e.g. a
   * budget increase) even though most writes don't need one.
   */
  create(
    sessionId: string,
    cls: Exclude<ApprovalClass, "read">,
    action: string,
    summary: string,
    reasonRequired = false,
  ): ApprovalRequest {
    const now = new Date();
    const row: ApprovalRow = {
      id: randomUUID(),
      session_id: sessionId,
      class: cls,
      action,
      summary,
      created_at: now.toISOString(),
      timeout_at: new Date(now.getTime() + this.timeoutMs).toISOString(),
      status: "pending",
      reason_required: cls === "destructive" || reasonRequired ? 1 : 0,
      reason: null,
      decided_at: null,
      decided_by_label: null,
      signature: null,
    };
    this.db
      .prepare(
        `INSERT INTO approvals (id, session_id, class, action, summary, created_at, timeout_at, status, reason_required, reason, decided_at, decided_by_label, signature)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.session_id,
        row.class,
        row.action,
        row.summary,
        row.created_at,
        row.timeout_at,
        row.status,
        row.reason_required,
        row.reason,
        row.decided_at,
        row.decided_by_label,
        row.signature,
      );
    return rowToRequest(row);
  }

  /** Fail-closed timeout: reads never return a stale "pending" past its
   * deadline — the transition to `timed_out` is applied (and persisted)
   * before the value is ever handed back, not left for a caller to notice. */
  private resolveIfExpired(row: ApprovalRow): ApprovalRow {
    if (row.status !== "pending") return row;
    if (new Date(row.timeout_at).getTime() > Date.now()) return row;
    this.db
      .prepare("UPDATE approvals SET status = 'timed_out', decided_at = ? WHERE id = ?")
      .run(new Date().toISOString(), row.id);
    return { ...row, status: "timed_out", decided_at: new Date().toISOString() };
  }

  get(id: string): ApprovalRequest | undefined {
    const row = this.db.prepare("SELECT * FROM approvals WHERE id = ?").get(id) as unknown as ApprovalRow | undefined;
    if (!row) return undefined;
    return rowToRequest(this.resolveIfExpired(row));
  }

  list(status?: ApprovalStatus): ApprovalRequest[] {
    const rows = (
      status
        ? (this.db.prepare("SELECT * FROM approvals WHERE status = ? ORDER BY created_at DESC").all(status) as unknown as ApprovalRow[])
        : (this.db.prepare("SELECT * FROM approvals ORDER BY created_at DESC").all() as unknown as ApprovalRow[])
    ).map((r) => this.resolveIfExpired(r));
    return rows.map(rowToRequest);
  }

  /** Optional periodic hygiene (see ADR-0007) — the lazy check in
   * get()/list() already makes "pending past its deadline" unobservable,
   * this just avoids a request that's never read again sitting stale in
   * the table forever. */
  sweepExpired(): number {
    const pending = this.db.prepare("SELECT * FROM approvals WHERE status = 'pending'").all() as unknown as ApprovalRow[];
    let swept = 0;
    for (const row of pending) {
      const resolved = this.resolveIfExpired(row);
      if (resolved.status === "timed_out") swept++;
    }
    return swept;
  }

  private static canonicalPayload(id: string, sessionId: string, decision: string, reason: string | null, decidedAt: string): string {
    return JSON.stringify({ id, sessionId, decision, reason, decidedAt });
  }

  /**
   * The `write`-class decision path (ADR-0007). `rawDeviceToken` is the
   * caller's already-auth-verified bearer token — never persisted, used
   * only as HMAC key material for this one call. `destructive` is
   * refused outright here: decideBiometric() (T2.5) is the only path
   * that can ever approve one, and only after a real, already-verified
   * WebAuthn assertion — never this weaker bearer-token HMAC.
   */
  decide(
    id: string,
    decision: "approve" | "reject",
    rawDeviceToken: string,
    deviceLabel: string,
    reason?: string,
  ): DecideResult {
    const current = this.get(id); // applies the fail-closed timeout check first
    if (!current) return { ok: false, detail: "unknown approval" };
    if (current.status !== "pending") {
      return { ok: false, detail: `already ${current.status}`, request: current };
    }
    if (current.class === "destructive") {
      return { ok: false, detail: "destructive approvals require WebAuthn (T2.5) — not yet wired", request: current };
    }
    if (decision === "approve" && current.reasonRequired && !reason?.trim()) {
      return { ok: false, detail: "reason required for this approval", request: current };
    }
    const decidedAt = new Date().toISOString();
    const status: ApprovalStatus = decision === "approve" ? "approved" : "rejected";
    const finalReason = reason?.trim() ? reason.trim() : null;
    const signature = createHmac("sha256", rawDeviceToken)
      .update(ApprovalService.canonicalPayload(id, current.sessionId, decision, finalReason, decidedAt))
      .digest("hex");
    this.db
      .prepare(
        "UPDATE approvals SET status = ?, reason = ?, decided_at = ?, decided_by_label = ?, signature = ? WHERE id = ?",
      )
      .run(status, finalReason, decidedAt, deviceLabel, signature, id);
    return { ok: true, request: this.get(id)! };
  }

  /**
   * T2.5: the ONLY path that can approve/reject a `destructive` request.
   * `verifiedAssertionFingerprint` must already be the output of a real,
   * successfully verified WebAuthn assertion (packages/server/src/
   * webauthn.ts) — this method does no cryptographic verification itself,
   * it only refuses to run against the wrong class and records what was
   * already proven. Reason is always required for destructive (set at
   * create() time), enforced the same way as the write path.
   */
  decideBiometric(
    id: string,
    decision: "approve" | "reject",
    verifiedAssertionFingerprint: string,
    deviceLabel: string,
    reason?: string,
  ): DecideResult {
    const current = this.get(id);
    if (!current) return { ok: false, detail: "unknown approval" };
    if (current.status !== "pending") {
      return { ok: false, detail: `already ${current.status}`, request: current };
    }
    if (current.class !== "destructive") {
      return { ok: false, detail: "decideBiometric() is only for destructive approvals — use decide()", request: current };
    }
    if (decision === "approve" && current.reasonRequired && !reason?.trim()) {
      return { ok: false, detail: "reason required for this approval", request: current };
    }
    const decidedAt = new Date().toISOString();
    const status: ApprovalStatus = decision === "approve" ? "approved" : "rejected";
    const finalReason = reason?.trim() ? reason.trim() : null;
    this.db
      .prepare(
        "UPDATE approvals SET status = ?, reason = ?, decided_at = ?, decided_by_label = ?, signature = ? WHERE id = ?",
      )
      .run(status, finalReason, decidedAt, deviceLabel, verifiedAssertionFingerprint, id);
    return { ok: true, request: this.get(id)! };
  }
}
