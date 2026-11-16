import { describe, expect, it } from "vitest";
import { NormalizedEvent, type TurnMetric } from "@ancientvoid/contracts";
import { deriveTurnMetrics } from "../../../src/modules/runs/index.ts";
import { aggregateTurnStatistics, statisticsDistribution } from "../../../src/modules/statistics/index.ts";

const turn = (patch: Partial<TurnMetric> = {}): TurnMetric => ({
  sessionId: "s1", turn: 1, adapter: "codex", model: "m1",
  startedAt: "2026-11-15T10:00:00.000Z", endedAt: "2026-11-15T10:00:01.000Z",
  durationMs: 1000, tokens: 100, tokensSource: "native", costUsd: null,
  events: 2, toolCalls: 0, outcome: "ok", ...patch,
});

describe("P56 Statistik-Grundlage", () => {
  it("berechnet p50/p90/p95 durch lineare Interpolation, ohne die Eingabe zu sortieren", () => {
    const input = [100, 20, 90, 10, 30, 80, 40, 70, 50, 60];
    const before = [...input];
    const distribution = statisticsDistribution(input);
    expect(distribution).toMatchObject({ n: 10, missing: 0, p50: 55, p90: 91, smallSample: false });
    expect(distribution.p95).toBeCloseTo(95.5, 10);
    expect(input).toEqual(before);
  });

  it("zählt fehlende Messwerte getrennt und lässt gemeldete Nullwerte stehen", () => {
    expect(statisticsDistribution([null, 0, null])).toEqual({ n: 1, missing: 2, p50: 0, p90: 0, p95: 0, smallSample: true });
    expect(statisticsDistribution([null, null])).toEqual({ n: 0, missing: 2, p50: null, p90: null, p95: null, smallSample: true });
    expect(statisticsDistribution([])).toEqual({ n: 0, missing: 0, p50: null, p90: null, p95: null, smallSample: true });
    expect(statisticsDistribution(Array(9).fill(1)).smallSample).toBe(true);
  });

  it.each([-1, NaN, Infinity, -Infinity])("weist ungültige Messwerte zurück: %s", value => {
    expect(() => statisticsDistribution([value])).toThrow();
  });

  it("verwirft fehlgeschlagene Züge nicht und verschweigt Token-Lücken oder Schätzungen nicht", () => {
    const result = aggregateTurnStatistics([
      turn({ turn: 1, durationMs: 10, tokens: 0 }),
      turn({ turn: 2, durationMs: 1000, tokens: null, tokensSource: null, outcome: "error" }),
      turn({ turn: 3, durationMs: 100, tokens: 20, tokensSource: "estimated" }),
    ]);
    expect(result).toEqual([{
      adapter: "codex", model: "m1", turns: 3, failedTurns: 1, estimatedTokenTurns: 1,
      durationMs: { n: 3, missing: 0, p50: 100, p90: 820, p95: expect.closeTo(910, 10), smallSample: true },
      tokens: { n: 2, missing: 1, p50: 10, p90: 18, p95: 19, smallSample: true },
    }]);
  });

  it("gruppiert nur nach belegter Adapter-/Modell-ID und bleibt bei anderer Eingabereihenfolge identisch", () => {
    const input = [turn({ adapter: "z", model: null }), turn({ adapter: "a", model: "" }), turn({ adapter: "a", model: null })];
    // Eigene Sessions: gleichnamige Zugnummern verschiedener Sessions sind kein Duplikat.
    input.forEach((t, i) => { t.sessionId = `s${i}`; });
    const result = aggregateTurnStatistics(input);
    expect(result.map(g => [g.adapter, g.model])).toEqual([["a", ""], ["a", null], ["z", null]]);
    expect(aggregateTurnStatistics([...input].reverse())).toEqual(result);
    expect(aggregateTurnStatistics([])).toEqual([]);
  });

  it("lehnt doppelte Zugidentitäten ab, statt einen Replay doppelt zu zählen", () => {
    expect(() => aggregateTurnStatistics([turn(), turn()])).toThrow(/duplicate/i);
    expect(() => aggregateTurnStatistics([turn({ tokens: 1, tokensSource: null })])).toThrow();
  });

  it("leitet identische Statistiken aus erneut abgespielten echten NormalizedEvents ab", () => {
    const event = (seq: number, ms: number, patch: Record<string, unknown>) => NormalizedEvent.parse({
      seq, ts: new Date(Date.parse("2026-11-15T10:00:00.000Z") + ms).toISOString(),
      sessionId: "s1", type: "system", summary: "fixture", ...patch,
    });
    const journal = [
      event(1, 0, { type: "assistant", tokensEst: 10, payload: {} }),
      event(2, 100, { payload: { kind: "session.turn_end", code: 0 } }),
      event(3, 200, { type: "error", payload: {} }),
      event(4, 500, { payload: { kind: "session.turn_end", code: 1 } }),
    ];
    const project = () => aggregateTurnStatistics(deriveTurnMetrics(journal, { sessionId: "s1", adapter: "codex", model: null }));
    const first = project();
    expect(first[0]?.failedTurns).toBe(1);
    expect(first[0]?.durationMs).toMatchObject({ n: 2, p50: 200, p90: 280, p95: 290 });
    expect(first[0]?.tokens).toMatchObject({ n: 1, missing: 1, p50: 10 });
    expect(project()).toEqual(first);
  });
});
