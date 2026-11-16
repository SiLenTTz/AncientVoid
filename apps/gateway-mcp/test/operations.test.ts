import { describe, it, expect } from "vitest";
import { OPERATIONS, findOperation, searchOperations } from "../src/operations.ts";

// Real session ids are always randomUUID() — see operations.ts's own
// SessionIdArgs doc comment (H-1 fix). Fixtures use a real-shaped UUID
// throughout instead of the old placeholder "abc-123".
const SID = "3fa3a1c2-6b3a-4b7a-8c9d-1a2b3c4d5e6f";

describe("gateway-mcp operations registry (T4.6)", () => {
  it("never exposes an approval-decide or destructive-classed operation — human-in-the-loop stays human", () => {
    for (const op of OPERATIONS) {
      expect(op.id).not.toMatch(/decide/i);
      expect(op.class).not.toBe("destructive");
    }
  });

  it("searchOperations matches by keyword in id or description", () => {
    const results = searchOperations("budget");
    expect(results.some((r) => r.id === "sessions.budget_topup")).toBe(true);
  });

  it("searchOperations returns everything for an empty query, nothing crashes", () => {
    expect(searchOperations("").length).toBe(OPERATIONS.length);
  });

  it("searchOperations returns nothing for a query matching no operation", () => {
    expect(searchOperations("xyzzy-nonexistent")).toEqual([]);
  });

  it("findOperation resolves a real id and returns undefined for an unknown one", () => {
    expect(findOperation("sessions.list")).toBeDefined();
    expect(findOperation("does.not.exist")).toBeUndefined();
  });

  it("sessions.get builds a real GET request path from validated args", () => {
    const op = findOperation("sessions.get")!;
    const req = op.request({ sessionId: SID });
    expect(req).toEqual({ method: "GET", path: `/api/sessions/${SID}` });
  });

  it("sessions.steer_prompt builds a real POST request with the write body", () => {
    const op = findOperation("sessions.steer_prompt")!;
    const req = op.request({ sessionId: SID, text: "go" });
    expect(req).toEqual({
      method: "POST",
      path: `/api/sessions/${SID}/steer`,
      body: { kind: "prompt", text: "go" },
    });
  });

  // H-1 (independent red-team review, 2026-09-18, T4.10): a crafted
  // sessionId used to make the WHATWG URL parser truncate the path at an
  // embedded `?`, silently redirecting a steer_prompt call onto
  // `/api/sessions/<id>/stop`. Real ids are always UUIDs — reject
  // anything else before it ever reaches path interpolation.
  it("rejects a non-UUID sessionId outright — closes the real path-confusion exploit (H-1)", () => {
    const steer = findOperation("sessions.steer_prompt")!;
    expect(steer.argsSchema.safeParse({ sessionId: "abc-123/stop?", text: "go" }).success).toBe(false);
    expect(() => steer.request({ sessionId: "abc-123/stop?", text: "go" })).toThrow();

    const get = findOperation("sessions.get")!;
    expect(get.argsSchema.safeParse({ sessionId: "../tokens" }).success).toBe(false);
    expect(() => get.request({ sessionId: "../tokens" })).toThrow();
  });

  it("argsSchema rejects missing required arguments for every operation that has any", () => {
    // sessions.list/approvals.list take no required args (z.object({})) —
    // real, not an oversight: they need nothing to run. Everything else
    // requires at least sessionId.
    const requireSomething = OPERATIONS.filter((o) => o.id !== "sessions.list" && o.id !== "approvals.list");
    expect(requireSomething.length).toBeGreaterThan(0);
    for (const op of requireSomething) {
      expect(op.argsSchema.safeParse({}).success).toBe(false);
    }
  });
});
