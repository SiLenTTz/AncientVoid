import { describe, it, expect } from "vitest";
import { OPERATIONS, findOperation, searchOperations } from "../src/operations.ts";

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
    const req = op.request({ sessionId: "abc-123" });
    expect(req).toEqual({ method: "GET", path: "/api/sessions/abc-123" });
  });

  it("sessions.steer_prompt builds a real POST request with the write body", () => {
    const op = findOperation("sessions.steer_prompt")!;
    const req = op.request({ sessionId: "abc-123", text: "go" });
    expect(req).toEqual({
      method: "POST",
      path: "/api/sessions/abc-123/steer",
      body: { kind: "prompt", text: "go" },
    });
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
