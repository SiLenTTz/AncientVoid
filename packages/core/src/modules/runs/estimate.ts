import { MIN_TURNS_FOR_ESTIMATE, type RunEstimate, type TurnMetric } from "@uacc/contracts";

function quantile(sorted: readonly number[], q: number): number {
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

/** Only successful turns with a duration shape the estimate: failed ones end early and would flatter it. */
export function estimateRun(turns: readonly Pick<TurnMetric, "durationMs" | "tokens" | "outcome">[], basis: RunEstimate["basis"]): RunEstimate {
  const ok = turns.filter((t) => t.outcome === "ok" && t.durationMs > 0);
  if (ok.length === 0) return { state: "no-data", n: 0, basis: "none", medianMs: null, p80Ms: null, tokensPerSec: null };
  if (ok.length < MIN_TURNS_FOR_ESTIMATE) return { state: "too-few", n: ok.length, basis, medianMs: null, p80Ms: null, tokensPerSec: null };
  const durations = ok.map((t) => t.durationMs).sort((a, b) => a - b);
  const rates = ok
    .filter((t) => t.tokens !== null && t.tokens > 0)
    .map((t) => (t.tokens as number) / (t.durationMs / 1000))
    .sort((a, b) => a - b);
  return {
    state: "ok",
    n: ok.length,
    basis,
    medianMs: Math.round(quantile(durations, 0.5)),
    p80Ms: Math.round(quantile(durations, 0.8)),
    tokensPerSec: rates.length >= MIN_TURNS_FOR_ESTIMATE ? Math.round(quantile(rates, 0.5) * 10) / 10 : null,
  };
}
