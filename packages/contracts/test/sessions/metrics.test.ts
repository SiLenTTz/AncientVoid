import { describe, expect, it } from "vitest";
import { countMetrics, emptyMetricCounters, sessionMetrics, type MetricCounters } from "../../src/index.ts";

const TURN_END = { payload: { kind: "session.turn_end" } };
const run = (events: Parameters<typeof countMetrics>[1][]): MetricCounters => events.reduce(countMetrics, emptyMetricCounters());

describe("honest metrics (T7.7, ADR-0023)", () => {
  it("nothing reported is unknown — never a confirmed zero", () => {
    expect(sessionMetrics(emptyMetricCounters())).toEqual({ cost: "unknown", tokens: "unknown" });
    expect(sessionMetrics(run([{ payload: {} }, TURN_END, TURN_END]))).toEqual({ cost: "unknown", tokens: "unknown" });
  });

  it("every turn with a provider number is native", () => {
    const c = run([{ costUsd: 0.01, tokensEst: 100 }, TURN_END, { costUsd: 0.02, tokensEst: 50 }, TURN_END]);
    expect(sessionMetrics(c)).toEqual({ cost: "native", tokens: "native" });
    expect(c).toMatchObject({ turns: 2, costTurns: 2, tokenTurns: 2 });
  });

  it("a turn without a number makes the sum partial", () => {
    const c = run([{ costUsd: 0.01, tokensEst: 100 }, TURN_END, { tokensEst: 20 }, TURN_END]);
    expect(sessionMetrics(c)).toEqual({ cost: "partial", tokens: "native" });
  });

  it("a price table makes it estimated; estimated and missing together stay partial", () => {
    expect(sessionMetrics(run([{ costUsd: 0.5, costSource: "estimated", tokensEst: 9, tokensSource: "estimated" }, TURN_END]))).toEqual({ cost: "estimated", tokens: "estimated" });
    expect(sessionMetrics(run([{ costUsd: 0.5, costSource: "estimated" }, TURN_END, TURN_END])).cost).toBe("partial");
  });

  it("a running turn counts before its end; the value is not lost at the turn boundary", () => {
    const c = run([{ tokensEst: 5 }]);
    expect(sessionMetrics(c).tokens).toBe("native");
    expect(run([{ tokensEst: 5 }, TURN_END, TURN_END]).tokenTurns).toBe(1);
  });
});
