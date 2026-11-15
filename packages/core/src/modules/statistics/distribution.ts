import { STATISTICS_MIN_SAMPLE, type StatisticsDistribution } from "@ancientvoid/contracts";

/** Nur vergleichbare, nichtnegative Messwerte übergeben; keine stille Imputation. */
export function statisticsDistribution(samples: readonly (number | null)[]): StatisticsDistribution {
  const values: number[] = [];
  let missing = 0;
  for (const sample of samples) {
    if (sample === null) { missing++; continue; }
    if (!Number.isFinite(sample) || sample < 0) throw new Error("Ungültiger Statistik-Messwert.");
    values.push(sample);
  }
  values.sort((a, b) => a - b);
  const quantile = (q: number): number | null => {
    if (values.length === 0) return null;
    const index = (values.length - 1) * q;
    const lo = Math.floor(index), hi = Math.ceil(index);
    return values[lo]! + (values[hi]! - values[lo]!) * (index - lo);
  };
  return { n: values.length, missing, p50: quantile(0.5), p90: quantile(0.9), p95: quantile(0.95), smallSample: values.length < STATISTICS_MIN_SAMPLE };
}
