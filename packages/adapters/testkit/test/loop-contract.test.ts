import { describe, expect, it } from "vitest";
import { assertContractGreen, createFakeLoopConnector, runLoopContractTests } from "../src/index.ts";

describe("runLoopContractTests (T19.1)", () => {
  it("der Fake-Loop besteht die Suite", async () => {
    const results = await runLoopContractTests(createFakeLoopConnector, { spec: { options: { line: "alpha" } } });
    assertContractGreen(results);
    expect(results.length).toBeGreaterThanOrEqual(8);
  });

  it("ein Connector, der ein nicht angebotenes Steuern still annimmt, fällt durch", async () => {
    const lax = (config?: Record<string, unknown>) => {
      const c = createFakeLoopConnector(config);
      return { ...c, capabilities: () => ({ ...c.capabilities(), controls: ["pause"] as const }), control: async () => ({ ok: true }) };
    };
    const results = await runLoopContractTests(lax as never, { spec: { options: { line: "alpha" } } });
    expect(results.find((r) => r.name.startsWith("control()"))).toMatchObject({ ok: false });
  });

  it("eine riskante Betriebsart, die nicht in modes steht, fällt durch", async () => {
    const bad = (config?: Record<string, unknown>) => {
      const c = createFakeLoopConnector(config);
      return { ...c, capabilities: () => ({ ...c.capabilities(), riskyModes: ["dark"] }) };
    };
    const results = await runLoopContractTests(bad as never, { spec: { options: { line: "alpha" } } });
    expect(results.find((r) => r.name.startsWith("capabilities()"))).toMatchObject({ ok: false });
  });
});
