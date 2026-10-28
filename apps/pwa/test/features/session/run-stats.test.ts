import { describe, expect, it } from "vitest";
import { contextWindowFromEvents, latestModelName, turnTokenStats } from "../../../src/features/session/run-stats.ts";
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
