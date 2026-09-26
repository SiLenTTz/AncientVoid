import { describe, expect, it, beforeEach } from "vitest";
import type { NormalizedEvent } from "../../../src/shared/ws.ts";
import { turnTokenStats, turnsClosedBetween, contextText, contextLevel, contextWindowFromEvents } from "../../../src/features/session/run-stats.ts";

let seq = 0;
beforeEach(() => {
  seq = 0;
});
function event(partial: Partial<NormalizedEvent> & Pick<NormalizedEvent, "type" | "summary">): NormalizedEvent {
  return { seq: ++seq, ts: "2026-09-26T00:00:00.000Z", sessionId: "s", blobRef: null, payload: {}, ...partial };
}

describe("turnTokenStats (ADR-0032)", () => {
  it("sums tokensEst per turn and keeps the last context fill of each turn", () => {
    const events = [
      event({ type: "user", summary: "Frage 1" }),
      event({ type: "system", summary: "opencode.step", tokensEst: 100 }),
      event({ type: "system", summary: "Zug beendet", payload: { kind: "acp.turn_end", usage: { input: 9000, output: 500 } } }),
      event({ type: "system", summary: "session.turn_end", payload: { kind: "session.turn_end" } }),
      event({ type: "user", summary: "Frage 2" }),
      event({ type: "system", summary: "Zug beendet", payload: { kind: "acp.turn_end", usage: { input: 12000, output: 300 } }, tokensEst: 12300 }),
      event({ type: "system", summary: "session.turn_end", payload: { kind: "session.turn_end" } }),
    ];
    const stats = turnTokenStats(events);
    expect(stats.turns).toEqual([
      { endSeq: 4, tokens: 100, contextTokens: 9000 },
      { endSeq: 7, tokens: 12300, contextTokens: 12000 },
    ]);
    expect(stats.lastContextTokens).toBe(12000);
  });

  it("a turn without usage reports no context fill, never a guessed one", () => {
    const stats = turnTokenStats([event({ type: "user", summary: "x" }), event({ type: "system", summary: "session.turn_end", payload: { kind: "session.turn_end" }, tokensEst: 5 })]);
    expect(stats.turns[0]!.contextTokens).toBeNull();
    expect(stats.lastContextTokens).toBeNull();
  });

  it("claude's result line counts too — its tokensEst sits on the claude.result event", () => {
    const stats = turnTokenStats([
      event({ type: "system", summary: "claude: turn complete", tokensEst: 6, payload: { kind: "claude.result", usage: { input: 2, output: 4 } } }),
      event({ type: "system", summary: "session.turn_end", payload: { kind: "session.turn_end" } }),
    ]);
    expect(stats.turns[0]).toMatchObject({ tokens: 6, contextTokens: 2 });
  });
});

describe("turnsClosedBetween", () => {
  it("finds turns hidden by a filter — Chat hides session.turn_end itself", () => {
    const turns = turnTokenStats([
      event({ type: "user", summary: "a" }),
      event({ type: "assistant", summary: "Antwort" }),
      event({ type: "system", summary: "session.turn_end", payload: { kind: "session.turn_end" } }),
      event({ type: "user", summary: "b" }),
    ]).turns;
    // visible: seq 1, 2, 4 — the turn ended between 2 and 4
    expect(turnsClosedBetween(turns, 2, 4)).toHaveLength(1);
    expect(turnsClosedBetween(turns, 1, 2)).toHaveLength(0);
    expect(turnsClosedBetween(turns, 4, null)).toHaveLength(0);
  });
});

describe("contextWindowFromEvents (ADR-0032)", () => {
  it("the latest model announce wins; unknown models carry no window", () => {
    const events = [
      event({ type: "system", summary: "acp · m1", payload: { kind: "acp.model", model: "a/glm-5.3", contextWindowTokens: 1_000_000 } }),
      event({ type: "user", summary: "x" }),
      event({ type: "system", summary: "acp · m2", payload: { kind: "acp.model", model: "a/klein" } }),
    ];
    expect(contextWindowFromEvents(events)).toBeNull();
    expect(contextWindowFromEvents([events[0]!])).toBe(1_000_000);
    expect(contextWindowFromEvents([event({ type: "system", summary: "opencode · m", payload: { kind: "opencode.model", model: "opencode/big-pickle", contextWindowTokens: 200_000 } })])).toBe(200_000);
  });
});

describe("contextText / contextLevel", () => {
  it("a percentage only from two real numbers", () => {
    expect(contextText(9000, 200_000)).toBe("Kontext 5 % (9.000 / 200.000)");
    expect(contextText(9000, null)).toBe("Kontext 9.000 Tokens");
    expect(contextText(null, 200_000)).toBeNull();
  });

  it("warns from 80 %, red from 95 %", () => {
    expect(contextLevel(9000, 200_000)).toBeNull();
    expect(contextLevel(160_000, 200_000)).toBe("warn");
    expect(contextLevel(195_000, 200_000)).toBe("err");
    expect(contextLevel(160_000, null)).toBeNull();
  });
});
