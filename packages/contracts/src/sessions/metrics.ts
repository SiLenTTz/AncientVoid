import { z } from "zod";

/**
 * T7.7 / ADR-0023: how trustworthy a session's token and cost numbers are.
 * A missing number is never a confirmed zero.
 *
 * Per event: where a value came from — the provider's own report
 * (`native`), or a price table / heuristic in the adapter (`estimated`).
 */
export const MetricSource = z.enum(["native", "estimated"]);
export type MetricSource = z.infer<typeof MetricSource>;

/**
 * Per session:
 * - `unknown`   — no turn reported the value (not the same as 0),
 * - `partial`   — some finished turns reported it, others did not,
 * - `estimated` — every turn reported it, at least once estimated,
 * - `native`    — every turn reported it from the provider.
 */
export const MetricQuality = z.enum(["unknown", "partial", "estimated", "native"]);
export type MetricQuality = z.infer<typeof MetricQuality>;

/** What the hub counts to derive the quality — persisted with the session. */
export const MetricCounters = z.object({
  /** Finished turns (`session.turn_end`). */
  turns: z.number().int().nonnegative().default(0),
  costTurns: z.number().int().nonnegative().default(0),
  tokenTurns: z.number().int().nonnegative().default(0),
  /** Events that carried a value at all. */
  costEvents: z.number().int().nonnegative().default(0),
  tokenEvents: z.number().int().nonnegative().default(0),
  costEstimated: z.boolean().default(false),
  tokensEstimated: z.boolean().default(false),
  /** The running turn has seen a value (reset at its end). */
  costInTurn: z.boolean().default(false),
  tokensInTurn: z.boolean().default(false),
});
export type MetricCounters = z.infer<typeof MetricCounters>;

export const SessionMetrics = z.object({
  cost: MetricQuality,
  tokens: MetricQuality,
});
export type SessionMetrics = z.infer<typeof SessionMetrics>;

/** On the session record: the quality plus the evidence behind it. */
export const SessionMetricsState = SessionMetrics.extend({ counters: MetricCounters });
export type SessionMetricsState = z.infer<typeof SessionMetricsState>;

export function metricsState(counters: MetricCounters): SessionMetricsState {
  return { ...sessionMetrics(counters), counters };
}

export function emptyMetricCounters(): MetricCounters {
  return MetricCounters.parse({});
}

interface MetricEvent {
  costUsd?: number | undefined;
  tokensEst?: number | undefined;
  costSource?: MetricSource | undefined;
  tokensSource?: MetricSource | undefined;
  payload?: Record<string, unknown> | undefined;
}

/** Counts one event (pure: returns the new counters). */
export function countMetrics(counters: MetricCounters, event: MetricEvent): MetricCounters {
  const c = { ...counters };
  if (event.costUsd !== undefined) {
    c.costEvents += 1;
    c.costInTurn = true;
    if (event.costSource === "estimated") c.costEstimated = true;
  }
  if (event.tokensEst !== undefined) {
    c.tokenEvents += 1;
    c.tokensInTurn = true;
    if (event.tokensSource === "estimated") c.tokensEstimated = true;
  }
  if (event.payload?.kind === "session.turn_end") {
    c.turns += 1;
    if (c.costInTurn) c.costTurns += 1;
    if (c.tokensInTurn) c.tokenTurns += 1;
    c.costInTurn = false;
    c.tokensInTurn = false;
  }
  return c;
}

function quality(events: number, turnsWith: number, turns: number, estimated: boolean): MetricQuality {
  if (events === 0) return "unknown";
  if (turnsWith < turns) return "partial";
  return estimated ? "estimated" : "native";
}

export function sessionMetrics(c: MetricCounters): SessionMetrics {
  return {
    cost: quality(c.costEvents, c.costTurns, c.turns, c.costEstimated),
    tokens: quality(c.tokenEvents, c.tokenTurns, c.turns, c.tokensEstimated),
  };
}
/** Safe default for fresh sessions (T15.5): parse with unknown qualities. */
export function prefaultSessionMetrics(): SessionMetricsState {
  return SessionMetricsState.parse({ cost: "unknown", tokens: "unknown", counters: {} });
}
