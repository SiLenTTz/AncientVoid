import { describe, expect, it } from "vitest";
import { POLICY, POLICY_OPERATIONS, actorKind, policyFor } from "../../src/approvals/policy.ts";

describe("policy table (T7.4)", () => {
  it("reads the actor from the token label", () => {
    expect(actorKind("pixel-9")).toBe("human");
    expect(actorKind("agent:mcp")).toBe("agent");
    expect(actorKind("bridge:abc")).toBe("bridge");
    expect(actorKind("fleet:omarchy")).toBe("fleet");
    expect(actorKind("companion:omarchy")).toBe("companion");
    expect(actorKind(null)).toBe("human");
  });

  it("invariant: an agent never writes directly — at most it requests", () => {
    for (const op of POLICY_OPERATIONS) {
      if (op === "read") continue;
      expect(POLICY[op].agent, op).not.toBe("allow");
    }
  });

  it("invariant: only humans (and a home hub acting for one) decide approvals; the bridge does nothing but ask", () => {
    expect(policyFor("approvals.decide", "agent:mcp")).toBe("deny");
    expect(policyFor("approvals.decide", "bridge:s1")).toBe("deny");
    expect(policyFor("approvals.decide", "pixel-9")).toBe("allow");
    for (const op of POLICY_OPERATIONS) expect(POLICY[op].bridge, op).toBe(op === "tools.ask" ? "allow" : "deny");
    expect(policyFor("tools.ask", "pixel-9"), "a human never answers in the provider's place").toBe("deny");
  });

  it("the emergency stop stays immediate for a human", () => {
    expect(policyFor("sessions.stop", "pixel-9")).toBe("allow");
    expect(policyFor("sessions.stop", "agent:mcp")).toBe("approve");
  });

  it("EPIC-P11: the companion does its one job and nothing else; only a person makes it type", () => {
    for (const op of POLICY_OPERATIONS) expect(POLICY[op].companion, op).toBe(op === "desktop.companion" ? "allow" : "deny");
    expect(policyFor("desktop.act", "pixel-9")).toBe("allow");
    expect(policyFor("desktop.act", "agent:mcp")).toBe("deny");
    expect(policyFor("desktop.act", "fleet:omarchy")).toBe("deny");
  });
});
