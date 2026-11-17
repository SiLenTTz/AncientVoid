import { describe, expect, it } from "vitest";
import { NormalizedEvent } from "@ancientvoid/contracts";
import { deriveRecoveryIntervals, deriveSessionFacts } from "../../../src/modules/statistics/index.ts";

const event = (seq: number, ms: number, patch: Record<string, unknown> = {}) => NormalizedEvent.parse({
  seq, ts: new Date(Date.parse("2026-11-15T10:00:00.000Z") + ms).toISOString(),
  sessionId: "s1", type: "system", summary: "fixture", payload: {}, ...patch,
});
const turnEnd = (seq: number, ms: number, payload: Record<string, unknown> = {}) =>
  event(seq, ms, { payload: { kind: "session.turn_end", ...payload } });
const who = { sessionId: "s1", adapter: "codex", model: null };

describe("P56 T56.1b Session-Fakten", () => {
  it("leitet Wallzeit, aktive Dauer und Zugzahl aus beendeten Zügen ab", () => {
    const journal = [
      event(1, 0, { type: "user" }),
      event(2, 100, { type: "assistant" }),
      turnEnd(3, 200, { code: 0 }),
      event(4, 300, { type: "user" }),
      event(5, 400, { type: "assistant" }),
      turnEnd(6, 500, { code: 0 }),
    ];
    expect(deriveSessionFacts(journal, who)).toEqual({
      sessionId: "s1", adapter: "codex", model: null,
      wallMs: 500, activeMs: 400, turns: 2, openTurn: false, endReason: "completed",
    });
  });

  it("klassifiziert den letzten terminalen Marker: Fehler, Unterbrechung, Nutzerstop", () => {
    const error = deriveSessionFacts([event(1, 0, { type: "user" }), turnEnd(2, 10, { code: 1 })], who);
    expect(error?.endReason).toBe("error");
    const reasonError = deriveSessionFacts([turnEnd(1, 0, { code: null, reason: "error" })], who);
    expect(reasonError?.endReason).toBe("error");
    const interrupted = deriveSessionFacts([turnEnd(1, 0, { code: null, reason: "interrupted" })], who);
    expect(interrupted?.endReason).toBe("interrupted");
    const stopped = deriveSessionFacts([turnEnd(1, 0, { code: 0 }), event(2, 5, { payload: { kind: "session.stopped", actor: "jan" } })], who);
    expect(stopped?.endReason).toBe("stopped");
  });

  it("ohne terminalen Marker bleibt der Endgrund unbekannt, ein offener Zug zählt nicht als Aktivität", () => {
    const open = deriveSessionFacts([event(1, 0, { type: "user" }), event(2, 100, { type: "assistant" })], who);
    expect(open).toMatchObject({ endReason: null, openTurn: true, turns: 0, activeMs: 0, wallMs: 100 });
    const partial = deriveSessionFacts([
      event(1, 0, { type: "user" }),
      event(2, 100, { type: "assistant" }),
      turnEnd(3, 200, { code: 0 }),
      event(4, 300, { type: "user" }),
    ], who);
    expect(partial).toMatchObject({ endReason: "completed", openTurn: true, turns: 1, activeMs: 200 });
  });

  it("ist bei anderer Ereignisreihenfolge identisch und ohne Events keine Messung", () => {
    const journal = [event(1, 0, { type: "user" }), turnEnd(2, 50, { code: 0 })];
    expect(deriveSessionFacts([...journal].reverse(), who)).toEqual(deriveSessionFacts(journal, who));
    expect(deriveSessionFacts([], who)).toBeNull();
  });
});

describe("P56 T56.1b Recovery-Intervalle", () => {
  it("misst von der Unterbrechung bis zum nächsten erfolgreich beendeten Zug", () => {
    const journal = [
      event(1, 0, { payload: { kind: "session.interrupted", reason: "hub_restart", since: "x" } }),
      turnEnd(2, 100, { code: null, reason: "interrupted" }),
      event(3, 500, { type: "user" }),
      turnEnd(4, 1500, { code: 0 }),
    ];
    expect(deriveRecoveryIntervals(journal, "s1")).toEqual([
      { sessionId: "s1", interruptedAt: journal[0]!.ts, recoveredAt: journal[3]!.ts, recoveryMs: 1500 },
    ]);
  });

  it("zählt den Unterbrechungsabschluss selbst und fehlerhafte Fortsetzungen nicht als Recovery", () => {
    const erroredResume = [
      event(1, 0, { payload: { kind: "session.interrupted", reason: "adapter_down" } }),
      turnEnd(2, 100, { code: null, reason: "interrupted" }),
      turnEnd(3, 1000, { code: 1 }),
      turnEnd(4, 2000, { code: 0 }),
    ];
    expect(deriveRecoveryIntervals(erroredResume, "s1")[0]?.recoveryMs).toBe(2000);
  });

  it("lässt jede Unterbrechung ohne belegten Weiterlauf offen", () => {
    expect(deriveRecoveryIntervals([
      event(1, 0, { payload: { kind: "session.interrupted", reason: "worker_exit" } }),
      turnEnd(2, 10, { code: null, reason: "interrupted" }),
    ], "s1")).toEqual([
      { sessionId: "s1", interruptedAt: expect.any(String), recoveredAt: null, recoveryMs: null },
    ]);
    const twice = [
      event(1, 0, { payload: { kind: "session.interrupted", reason: "hub_restart" } }),
      event(2, 1000, { payload: { kind: "session.interrupted", reason: "worker_exit" } }),
      turnEnd(3, 2000, { code: 0 }),
    ];
    expect(deriveRecoveryIntervals(twice, "s1").map(i => i.recoveryMs)).toEqual([null, 1000]);
  });
});
