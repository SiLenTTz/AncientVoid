import { describe, expect, it } from "vitest";
import type { Adapter, SlashCommand } from "@uacc/contracts";
import { basicFeatures } from "@uacc/contracts";
import { runContractTests } from "../src/index.ts";

/** ADR-0042 (EPIC-P25 T25.1): the kit validates declared slash commands. */
function adapterWith(commands: readonly SlashCommand[] | undefined): Adapter {
  return {
    id: "slashy",
    version: "1.0.0",
    capabilities: () => ({
      reasoning: false,
      tools: false,
      cost: false,
      steer: false,
      usage: false,
      nativeDiscovery: "none",
      nativeResume: "none",
      features: basicFeatures({ followUp: false, interrupt: false }),
      ...(commands !== undefined ? { commands } : {}),
    }),
    async start(_spec, ctx) {
      ctx.emit({ type: "system", summary: "started", payload: {} });
      return { sessionId: ctx.sessionId };
    },
    async steer() {
      return { ok: true };
    },
    async status() {
      return { state: "healthy" };
    },
    async stop() {
      return undefined;
    },
  };
}

async function capsResult(commands: readonly SlashCommand[] | undefined) {
  const results = await runContractTests(() => adapterWith(commands), { skipRecover: true });
  return results.find((r) => r.name === "capabilities(): complete shape");
}

describe("runContractTests capabilities().commands (ADR-0042)", () => {
  it("akzeptiert wohlgeformte Commands und lässt das Feld optional weg", async () => {
    expect((await capsResult(undefined))?.ok).toBe(true);
    expect((await capsResult([{ name: "/compact", description: "Kontext komprimieren", scope: "both" }, { name: "/new", description: "Neuer Kontext", scope: "start" }]))?.ok).toBe(true);
  });

  it("lehnt Namen ohne Schrägstrich ab", async () => {
    const r = await capsResult([{ name: "compact", description: "x", scope: "both" }]);
    expect(r?.ok).toBe(false);
    expect(r?.detail).toMatch(/must be a slash name/);
  });

  it("lehnt Duplikate und ungültige Scopes ab", async () => {
    const dup = await capsResult([{ name: "/compact", description: "x", scope: "both" }, { name: "/compact", description: "y", scope: "steer" }]);
    expect(dup?.ok).toBe(false);
    expect(dup?.detail).toMatch(/duplicate/);
    const scope = await capsResult([{ name: "/compact", description: "x", scope: "always" } as unknown as SlashCommand]);
    expect(scope?.ok).toBe(false);
    expect(scope?.detail).toMatch(/scope must be/);
  });

  it("lehnt eine leere Beschreibung ab", async () => {
    const r = await capsResult([{ name: "/compact", description: "  ", scope: "both" }]);
    expect(r?.ok).toBe(false);
    expect(r?.detail).toMatch(/needs a description/);
  });
});
