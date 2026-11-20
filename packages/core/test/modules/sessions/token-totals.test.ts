import { describe, expect, it } from "vitest";
import type { NormalizedEvent } from "@ancientvoid/contracts";
import { createTokenTally, tokenTotalsOf } from "../../../src/modules/sessions/token-totals.ts";

/** Nur die Felder, die die Bilanz auswertet — die Adapter-Formen werden hier nicht verzerrt. */
const ev = (o: Partial<NormalizedEvent> & { payload?: Record<string, unknown> }): NormalizedEvent =>
  ({ type: "system", summary: "usage", payload: {}, blobRef: null, seq: 1, ts: "2026-11-16T00:00:00Z", sessionId: "s", ...o }) as NormalizedEvent;

const usage = (payload: Record<string, unknown>, tokensEst?: number): NormalizedEvent =>
  ev({ payload: { kind: "pi.usage", usage: payload }, ...(tokensEst === undefined ? {} : { tokensEst }) });

describe("Token-Bilanz (ADR-0084, BUG-0184)", () => {
  it("verwechselt nie Kontext-Wiederholung mit erzeugten Tokens", () => {
    // Drei Aufrufe mit demselben 150k-Kontext: das ist die Quadratur aus BUG-0184.
    const calls = [usage({ input: 150_000, output: 100 }, 150_100), usage({ input: 150_000, output: 200 }, 150_200), usage({ input: 150_000, output: 300 }, 150_300)];
    const t = tokenTotalsOf(calls);
    expect(t.generated).toBe(600); // was der Agent wirklich schrieb
    expect(t.processed).toBe(450_600); // 3 × (Kontext + Ausgabe), ADR-0006
    expect(t.generated).not.toBe(t.processed);
    expect(t.contextFill).toBe(150_000); // die Füllung des letzten Aufrufs
    expect(t.usageEvents).toBe(3);
    expect(t.estimated).toBe(false);
  });

  it("mischt keine Summen, wenn niemand Zahlen meldet", () => {
    const t = tokenTotalsOf([ev({ payload: { kind: "pi.model", model: "qwen" } }), ev({ payload: {}, tokensEst: undefined })]);
    expect(t).toEqual({ generated: null, processed: null, contextFill: null, cacheRead: null, usageEvents: 0, estimated: false });
  });

  it("codex-Form: camelCase plus Reasoning- und Cache-Anteile", () => {
    const t = tokenTotalsOf([
      usage({ inputTokens: 9_000, cachedInputTokens: 8_000, outputTokens: 400, reasoningOutputTokens: 120 }, 9_400),
      usage({ inputTokens: 9_500, cachedInputTokens: 9_000, outputTokens: 80 }, 9_580),
    ]);
    expect(t.generated).toBe(600); // Ausgabe + Reasoning (Denken ist erzeugter Text)
    expect(t.processed).toBe(18_980);
    expect(t.cacheRead).toBe(17_000);
    expect(t.contextFill).toBe(9_500);
  });

  it("claude/cursor-Rohform input_tokens/output_tokens zählt mit", () => {
    const t = tokenTotalsOf([usage({ input_tokens: 1_000, output_tokens: 250 }, 1_250)]);
    expect(t.generated).toBe(250);
    expect(t.processed).toBe(1_250);
  });

  it("Schätzung bleibt als solche markiert (T7.7)", () => {
    const t = tokenTotalsOf([ev({ tokensEst: 500, tokensSource: "estimated" })]);
    expect(t.processed).toBe(500);
    expect(t.generated).toBeNull();
    expect(t.estimated).toBe(true);
  });

  it("seitenweises Zählen ergibt dasselbe wie die Liste am Stück", () => {
    const calls = [usage({ input: 10, output: 1 }, 11), usage({ input: 12, output: 2 }, 14), usage({ input: 13, output: 3 }, 16)];
    const tally = createTokenTally();
    tally.add(calls.slice(0, 2));
    tally.add(calls.slice(2));
    expect(tally.result()).toEqual(tokenTotalsOf(calls));
  });

  it("ein Ereignis mit nur einem Wert zählt genau einmal als Nutzung", () => {
    const t = tokenTotalsOf([ev({ tokensEst: 42 }), usage({ output: 7 })]);
    expect(t.usageEvents).toBe(2);
    expect(t.processed).toBe(42);
    expect(t.generated).toBe(7);
  });

  it("BUG-0242: behält den nativen Kontext auch seitenübergreifend", () => {
    const tally = createTokenTally();
    tally.add([ev({ payload: { kind: "acp.context", contextInputTokens: 45, contextWindowTokens: 180 } })]);
    tally.add([ev({ payload: { kind: "acp.turn_end", usage: { input: 30, output: 12 } }, tokensEst: 42 })]);
    expect(tally.result()).toMatchObject({ contextFill: 45, processed: 42, generated: 12 });
  });
});
