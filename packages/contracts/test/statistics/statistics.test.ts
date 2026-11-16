import { describe, expect, it } from "vitest";
import { StatisticsDistribution, TurnStatistics } from "@ancientvoid/contracts";

const distribution = { n: 2, missing: 1, p50: 10, p90: 18, p95: 19, smallSample: true };

describe("P56 Statistik-Vertrag", () => {
  it("unterscheidet fehlende Werte von einer gemeldeten Null", () => {
    expect(StatisticsDistribution.parse({ n: 0, missing: 3, p50: null, p90: null, p95: null, smallSample: true }).p50).toBeNull();
    expect(StatisticsDistribution.parse({ n: 1, missing: 0, p50: 0, p90: 0, p95: 0, smallSample: true }).p50).toBe(0);
  });

  it.each([
    { ...distribution, n: 0 },
    { ...distribution, p90: null },
    { ...distribution, p50: 20 },
    { ...distribution, p95: 17 },
    { ...distribution, missing: -1 },
    { ...distribution, n: 1.5 },
    { ...distribution, n: Number.MAX_SAFE_INTEGER + 1 },
    { ...distribution, p95: Infinity },
    { ...distribution, p50: NaN },
    { ...distribution, smallSample: false },
    { ...distribution, unit: "invented" },
  ])("weist widersprüchliche oder ungültige Verteilungen ab: %j", value => {
    expect(StatisticsDistribution.safeParse(value).success).toBe(false);
  });

  it("bindet Klein-n an die tatsächlich gemeldeten Werte", () => {
    expect(StatisticsDistribution.safeParse({ ...distribution, n: 10, missing: 100, smallSample: false }).success).toBe(true);
    expect(StatisticsDistribution.safeParse({ ...distribution, n: 10, smallSample: true }).success).toBe(false);
  });

  it("führt alle Züge und die Herkunft geschätzter Tokenwerte", () => {
    const value = { adapter: "codex", model: null, turns: 3, failedTurns: 1, durationMs: { ...distribution, n: 3, missing: 0 }, tokens: distribution, estimatedTokenTurns: 1 };
    expect(TurnStatistics.parse(value)).toEqual(value);
    for (const patch of [{ failedTurns: 4 }, { estimatedTokenTurns: 3 }, { turns: 0 }, { tokens: { ...distribution, missing: 0 } }, { durationMs: distribution }]) {
      expect(TurnStatistics.safeParse({ ...value, ...patch }).success).toBe(false);
    }
  });
});
