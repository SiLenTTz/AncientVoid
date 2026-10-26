import { describe, it, expect } from "vitest";
import type { Adapter, AdapterCapabilities } from "@uacc/contracts";
import { runContractTests } from "../src/index.ts";

/**
 * ADR-0036 (EPIC-P17 T17.2): the kit must accept a missing declaration
 * (honest state) and reject malformed ones — the live hand-run BEHIND a
 * declaration stays an MR-description duty (AC-P17-2), the shape is not.
 * Only the capabilities check is asserted; the rest of the suite may
 * legitimately fail against this minimal fake.
 */
function fakeAdapter(resume: AdapterCapabilities["resume"]): Adapter {
  return {
    id: "fake",
    version: "0.0.1",
    capabilities(): AdapterCapabilities {
      return {
        reasoning: false,
        tools: false,
        cost: false,
        steer: false,
        usage: false,
        nativeDiscovery: "none",
        nativeResume: "none",
        ...(resume !== undefined ? { resume } : {}),
        features: {
          followUp: false,
          interrupt: false,
          toolGate: "none",
          questions: false,
          modelChoice: "none",
          modelSwitch: false,
          permissionModes: [],
          skills: false,
          agents: false,
          images: false,
          files: false,
          contextFork: false,
        },
      };
    },
    async start(_spec, ctx) {
      ctx.emit({ type: "system", summary: "fake", payload: {} });
      return { sessionId: "fake-session" };
    },
    async stop() {
      /* nothing to stop */
    },
  } as unknown as Adapter;
}

async function capabilitiesCheck(resume: AdapterCapabilities["resume"]) {
  const results = await runContractTests(() => fakeAdapter(resume), { skipRecover: true });
  return results.find((r) => r.name.startsWith("capabilities"))!;
}

describe("resume declaration check (ADR-0036)", () => {
  it("accepts a missing declaration — no known path is the honest state", async () => {
    const check = await capabilitiesCheck(undefined);
    expect(check.ok).toBe(true);
  });

  it("accepts a well-formed native template", async () => {
    const check = await capabilitiesCheck({ argv: ["claude", "--resume", "{sessionId}"], ref: "native" });
    expect(check.ok).toBe(true);
  });

  it("rejects an argv without a placeholder — nothing substitutable to show", async () => {
    const check = await capabilitiesCheck({ argv: ["claude", "--resume"], ref: "native" });
    expect(check.ok).toBe(false);
    expect(check.detail).toMatch(/placeholder/);
  });

  it("rejects an invalid ref", async () => {
    const check = await capabilitiesCheck({ argv: ["x", "{token}"], ref: "sideways" as "native" });
    expect(check.ok).toBe(false);
    expect(check.detail).toMatch(/ref/);
  });

  it("rejects an empty argv", async () => {
    const check = await capabilitiesCheck({ argv: [], ref: "token" });
    expect(check.ok).toBe(false);
    expect(check.detail).toMatch(/argv/);
  });
});
