import { describe, expect, it } from "vitest";
import { contextWindowFromEvents, latestModelName, turnTokenStats, tokenParts, compactTokens, turnStatsText } from "../../../src/features/session/run-stats.ts";
import type { NormalizedEvent } from "../../../src/shared/ws.ts";

function ev(type: string, payload: Record<string, unknown>, extra: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return { seq: 1, ts: "2026-10-28T00:00:00Z", sessionId: "s", type, summary: "", payload, blobRef: null, ...extra };
}

describe("turnTokenStats — Kontextfüllung aus allen Adapter-Formaten", () => {
  it("liest usage.input (claude, cursor, acp, pi)", () => {
    const stats = turnTokenStats([ev("system", { usage: { input: 1200, output: 30 } })]);
    expect(stats.lastContextTokens).toBe(1200);
  });

  it("liest usage.inputTokens (codex exec, camelCase normalizedUsage)", () => {
    const stats = turnTokenStats([ev("system", { kind: "codex.turn_complete", usage: { inputTokens: 15_500, outputTokens: 4 } })]);
    expect(stats.lastContextTokens).toBe(15_500);
  });

  it("die letzte Meldung gewinnt, auch über mehrere Turns", () => {
    const stats = turnTokenStats([
      ev("system", { usage: { input: 100 } }),
      ev("system", { kind: "session.turn_end", code: 0 }, { seq: 2 }),
      ev("system", { usage: { input: 900 } }),
      ev("system", { kind: "session.turn_end", code: 0 }, { seq: 3 }),
    ]);
    expect(stats.lastContextTokens).toBe(900);
    expect(stats.turns.map((t) => t.contextTokens)).toEqual([100, 900]);
  });

  it("läuft der erste Zug noch, steht die Füllung trotzdem da (nicht erst ab turn_end)", () => {
    const stats = turnTokenStats([ev("system", { usage: { input: 700 } })]);
    expect(stats.lastContextTokens).toBe(700);
    expect(stats.turns).toHaveLength(0);
  });

  it("ohne jede Usage-Meldung bleibt es ehrlich unbekannt", () => {
    expect(turnTokenStats([ev("assistant", { text: "hallo" })]).lastContextTokens).toBeNull();
  });
});

describe("contextWindowFromEvents / latestModelName — Modell-Ansagen", () => {
  it("cursor.model trägt eine Fenstergröße wie acp/pi/opencode", () => {
    const events = [ev("system", { kind: "cursor.model", model: "auto", contextWindowTokens: 131_072 })];
    expect(contextWindowFromEvents(events)).toBe(131_072);
    expect(latestModelName(events)).toBe("auto");
  });

  it("die jüngste Ansage gewinnt; ohne Fenstergröße bleibt sie ehrlich null", () => {
    expect(
      contextWindowFromEvents([
        ev("system", { kind: "pi.model", model: "alt", contextWindowTokens: 100 }),
        ev("system", { kind: "acp.model", model: "neu" }, { seq: 2 }),
      ]),
    ).toBeNull();
    expect(latestModelName([ev("system", { kind: "pi.model", model: "pi-1" })])).toBe("pi-1");
  });

  it("fremde Events und Modell-Announce ohne Name melden null", () => {
    expect(contextWindowFromEvents([ev("assistant", { text: "x" })])).toBeNull();
    expect(latestModelName([ev("system", { kind: "acp.model" })])).toBeNull();
  });
});

describe("ehrliche Token-Beschriftung (BUG-0182, ADR-0084)", () => {
  it("nennt beide Zahlen beim Namen — und nie ein nacktes Σ", () => {
    const parts = tokenParts({ generated: 947_340, processed: 272_613_546, estimated: false });
    expect(parts).toEqual(["947.340 Tokens erzeugt", "272,6 Mio Tokens verarbeitet"]);
    expect(parts.join(" · ")).not.toContain("Σ");
  });

  it("eine ungemeldete Zahl fehlt, statt mit 0 gefüllt zu werden", () => {
    expect(tokenParts({ generated: null, processed: 42, estimated: true })).toEqual(["42 Tokens verarbeitet (Anteile geschätzt)"]);
    expect(tokenParts({ generated: null, processed: null, estimated: false })).toEqual([]);
  });

  it("Zug-Zeile unterscheidet erzeugt und verarbeitet", () => {
    const turns = turnTokenStats([
      ev("system", { usage: { input: 150_000, output: 40 } }, { tokensEst: 150_040 }),
      ev("system", { kind: "session.turn_end" }),
    ]).turns;
    expect(turnStatsText(1, turns)).toBe("Zug 1: 40 Tokens erzeugt · 150.040 verarbeitet · Kontext 150.000");
  });

  it("Zug-Zeile ohne gemeldete Ausgabe erfindet keine Ausgabe", () => {
    const turns = turnTokenStats([ev("system", {}, { tokensEst: 900 }), ev("system", { kind: "session.turn_end" })]).turns;
    expect(turnStatsText(2, turns)).toBe("Zug 2: 900 verarbeitet");
  });

  it("kurze Form bleibt unter einer Million exakt", () => {
    expect(compactTokens(999_999)).toBe("999.999");
    expect(compactTokens(1_500_000)).toBe("1,5 Mio");
    expect(compactTokens(272_613_546)).toBe("272,6 Mio");
  });

  it("Reasoning-Tokens zählen zum Erzeugten (codex-Form)", () => {
    const turns = turnTokenStats([
      ev("system", { usage: { inputTokens: 9_000, outputTokens: 300, reasoningOutputTokens: 120 } }, { tokensEst: 9_420 }),
      ev("system", { kind: "session.turn_end" }),
    ]).turns;
    expect(turnStatsText(1, turns)).toBe("Zug 1: 420 Tokens erzeugt · 9.420 verarbeitet · Kontext 9.000");
  });
});
