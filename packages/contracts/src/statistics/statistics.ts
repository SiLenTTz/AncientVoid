import { z } from "zod";

/** P56 / ADR-0079: fehlende Messung ist keine Null; n zählt nur belegte Werte. */
export const STATISTICS_MIN_SAMPLE = 10;
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const quantile = z.number().nonnegative().nullable();

export const StatisticsDistribution = z.object({
  n: count,
  missing: count,
  p50: quantile,
  p90: quantile,
  p95: quantile,
  smallSample: z.boolean(),
}).strict().refine(d => {
  if (d.smallSample !== (d.n < STATISTICS_MIN_SAMPLE)) return false;
  if (d.n === 0) return d.p50 === null && d.p90 === null && d.p95 === null;
  return d.p50 !== null && d.p90 !== null && d.p95 !== null && d.p50 <= d.p90 && d.p90 <= d.p95;
}, "Quantile, Stichprobe und Klein-n-Kennzeichnung widersprechen sich.");
export type StatisticsDistribution = z.infer<typeof StatisticsDistribution>;

/** Belegte Zugzahlen, kein Session-Endurteil und kein Qualitätsranking. */
export const TurnStatistics = z.object({
  adapter: z.string().min(1),
  model: z.string().nullable(),
  turns: count.refine(n => n > 0),
  failedTurns: count,
  durationMs: StatisticsDistribution,
  tokens: StatisticsDistribution,
  estimatedTokenTurns: count,
}).strict().refine(g =>
  g.failedTurns <= g.turns && g.durationMs.n === g.turns && g.durationMs.missing === 0 &&
  g.tokens.n + g.tokens.missing === g.turns && g.estimatedTokenTurns <= g.tokens.n,
"Zugzahlen, Datenabdeckung oder Token-Herkunft widersprechen sich.");
export type TurnStatistics = z.infer<typeof TurnStatistics>;
