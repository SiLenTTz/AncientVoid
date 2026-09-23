import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { HubDatabase } from "../../../src/platform/db.ts";
import { ApprovalService } from "../../../src/modules/approvals/approvals.ts";

function make(timeoutMs?: number) {
  const db = new HubDatabase(":memory:");
  const approvals = new ApprovalService(db, timeoutMs);
  return { db, approvals };
}

describe("ApprovalService (T2.4, ADR-0007)", () => {
  it("create(): a write-class request starts pending, no reason required by default", () => {
    const { approvals } = make();
    const req = approvals.create("s1", "write", "steer.prompt", "Prompt an claude senden: \"go\"");
    expect(req.status).toBe("pending");
    expect(req.class).toBe("write");
    expect(req.reasonRequired).toBe(false);
    expect(req.signature).toBeNull();
    expect(approvals.get(req.id)).toEqual(req);
  });

  it("create(): a destructive-class request always requires a reason", () => {
    const { approvals } = make();
    const req = approvals.create("s1", "destructive", "force-push", "force-push origin main");
    expect(req.reasonRequired).toBe(true);
  });

  it("decide(): approving writes a real HMAC signature over the raw device token, verifiable independently", () => {
    const { approvals } = make();
    const req = approvals.create("s1", "write", "steer.prompt", "go");
    const rawToken = "device-token-raw-value";
    const result = approvals.decide(req.id, "approve", rawToken, "pixel-9");
    expect(result.ok).toBe(true);
    const decided = result.request!;
    expect(decided.status).toBe("approved");
    expect(decided.decidedByLabel).toBe("pixel-9");
    expect(decided.signature).not.toBeNull();

    // AC-P2-5-adjacent: the signature really is a function of the raw
    // token — a different token produces a different signature for the
    // exact same decision payload, so it's a real proof of possession,
    // not a constant placeholder.
    const expected = createHmac("sha256", rawToken)
      .update(JSON.stringify({ id: req.id, sessionId: "s1", decision: "approve", reason: null, decidedAt: decided.decidedAt }))
      .digest("hex");
    expect(decided.signature).toBe(expected);

    const wrongTokenSig = createHmac("sha256", "some-other-token")
      .update(JSON.stringify({ id: req.id, sessionId: "s1", decision: "approve", reason: null, decidedAt: decided.decidedAt }))
      .digest("hex");
    expect(decided.signature).not.toBe(wrongTokenSig);
  });

  it("AC-P2-5: a write action opted into reasonRequired refuses approval without a reason, status stays pending", () => {
    const { approvals } = make();
    const req = approvals.create("s1", "write", "budget.increase", "Budget auf 10$ erhöhen", true);
    expect(req.reasonRequired).toBe(true);

    const withoutReason = approvals.decide(req.id, "approve", "tok", "pixel-9");
    expect(withoutReason.ok).toBe(false);
    expect(withoutReason.detail).toMatch(/reason required/);
    expect(approvals.get(req.id)!.status).toBe("pending"); // no audit entry as "approved"

    const withReason = approvals.decide(req.id, "approve", "tok", "pixel-9", "Budget für Debugging-Session nötig");
    expect(withReason.ok).toBe(true);
    expect(withReason.request!.status).toBe("approved");
    expect(withReason.request!.reason).toBe("Budget für Debugging-Session nötig");
  });

  it("a plain write action (reasonRequired not opted in) can be approved without a reason", () => {
    const { approvals } = make();
    const req = approvals.create("s1", "write", "steer.prompt", "go");
    expect(req.reasonRequired).toBe(false);
    const result = approvals.decide(req.id, "approve", "tok", "pixel-9");
    expect(result.ok).toBe(true);
  });

  it("destructive decisions are refused pre-T2.5 — no signature mechanism exists for them yet, never faked", () => {
    const { approvals } = make();
    const req = approvals.create("s1", "destructive", "force-push", "force-push origin main");
    const result = approvals.decide(req.id, "approve", "tok", "pixel-9", "because CI is broken");
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/WebAuthn/);
    expect(approvals.get(req.id)!.status).toBe("pending"); // unchanged, not silently approved
  });

  it("a decided approval is immutable — deciding twice is refused, first decision stands", () => {
    const { approvals } = make();
    const req = approvals.create("s1", "write", "steer.prompt", "go");
    approvals.decide(req.id, "approve", "tok", "pixel-9");
    const second = approvals.decide(req.id, "reject", "tok", "pixel-9");
    expect(second.ok).toBe(false);
    expect(second.detail).toMatch(/already approved/);
    expect(approvals.get(req.id)!.status).toBe("approved");
  });

  it("AC-P2-6: a pending request past its timeout is fail-closed to timed_out on read, not silently left pending", async () => {
    const { approvals } = make(20); // 20ms timeout — real clock, not fake timers
    const req = approvals.create("s1", "write", "steer.prompt", "go");
    expect(approvals.get(req.id)!.status).toBe("pending");
    await new Promise((r) => setTimeout(r, 40));
    expect(approvals.get(req.id)!.status).toBe("timed_out");
  });

  it("a timed-out request can no longer be approved", async () => {
    const { approvals } = make(20);
    const req = approvals.create("s1", "write", "steer.prompt", "go");
    await new Promise((r) => setTimeout(r, 40));
    const result = approvals.decide(req.id, "approve", "tok", "pixel-9");
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/already timed_out/);
  });

  it("sweepExpired(): proactively resolves stale pending requests and reports how many", async () => {
    const { approvals } = make(20);
    approvals.create("s1", "write", "steer.prompt", "go");
    approvals.create("s2", "write", "steer.prompt", "go2");
    await new Promise((r) => setTimeout(r, 40));
    const swept = approvals.sweepExpired();
    expect(swept).toBe(2);
    expect(approvals.list("timed_out")).toHaveLength(2);
  });

  it("list(status): filters correctly and orders newest first", () => {
    const { approvals } = make();
    const a = approvals.create("s1", "write", "steer.prompt", "a");
    const b = approvals.create("s1", "write", "steer.prompt", "b");
    approvals.decide(a.id, "approve", "tok", "pixel-9");
    const pending = approvals.list("pending");
    expect(pending.map((r) => r.id)).toEqual([b.id]);
    const approved = approvals.list("approved");
    expect(approved.map((r) => r.id)).toEqual([a.id]);
  });
});
