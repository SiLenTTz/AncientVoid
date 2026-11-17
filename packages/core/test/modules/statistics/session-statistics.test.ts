import { describe, expect, it } from "vitest";
import { SessionStatistics } from "@ancientvoid/contracts";
import { aggregateSessionStatistics, type SessionFacts } from "../../../src/modules/statistics/index.ts";

const facts = (patch: Partial<SessionFacts> = {}): SessionFacts => ({
  sessionId: "s1", adapter: "codex", model: "m1", wallMs: 1000, activeMs: 500,
  turns: 2, openTurn: false, endReason: "completed", ...patch,
});

describe("P56 T56.1b Session-Aggregation", () => {
  it("gruppiert nach belegter Adapter-/Modell-ID und zählt Endgründe inklusive offener Sessions", () => {
    const result = aggregateSessionStatistics([
      facts({ sessionId: "s1", wallMs: 1000 }),
      facts({ sessionId: "s2", adapter: "codex", model: "m1", wallMs: 3000, endReason: "error" }),
      facts({ sessionId: "s3", adapter: "codex", model: "m1", endReason: null }),
      facts({ sessionId: "s4", adapter: "codex", model: null, wallMs: null, endReason: "stopped" }),
    ]);
    expect(result).toEqual([
      {
        adapter: "codex", model: "m1", sessions: 3, openSessions: 1,
        endReasons: { completed: 1, error: 1, interrupted: 0, stopped: 0 },
        wallMs: { n: 3, missing: 0, p50: 1000, p90: 2600, p95: 2800, smallSample: true },
        activeMs: { n: 3, missing: 0, p50: 500, p90: 500, p95: 500, smallSample: true },
        turnsPerSession: { n: 3, missing: 0, p50: 2, p90: 2, p95: 2, smallSample: true },
      },
      {
        adapter: "codex", model: null, sessions: 1, openSessions: 0,
        endReasons: { completed: 0, error: 0, interrupted: 0, stopped: 1 },
        wallMs: { n: 0, missing: 1, p50: null, p90: null, p95: null, smallSample: true },
        activeMs: { n: 1, missing: 0, p50: 500, p90: 500, p95: 500, smallSample: true },
        turnsPerSession: { n: 1, missing: 0, p50: 2, p90: 2, p95: 2, smallSample: true },
      },
    ]);
    expect(result.map(g => SessionStatistics.parse(g))).toHaveLength(2);
  });

  it("bleibt bei anderer Eingabereihenfolge identisch und lehnt doppelte Sessions ab", () => {
    const input = [facts({ sessionId: "s1" }), facts({ sessionId: "s2", model: null })];
    expect(aggregateSessionStatistics([...input].reverse())).toEqual(aggregateSessionStatistics(input));
    expect(aggregateSessionStatistics([])).toEqual([]);
    expect(() => aggregateSessionStatistics([facts(), facts({ sessionId: "s1" })])).toThrow(/duplicate/i);
  });

  it("erzwingt die Abdeckungs-Invarianten im Contract", () => {
    const valid = aggregateSessionStatistics([facts()])[0]!;
    expect(() => SessionStatistics.parse({ ...valid, endReasons: { ...valid.endReasons, completed: valid.sessions + 1 } })).toThrow();
    expect(() => SessionStatistics.parse({ ...valid, openSessions: valid.sessions + 1 })).toThrow();
  });
});
