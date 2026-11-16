import type { SessionRecord } from "./api.ts";

/**
 * T7.7 (ADR-0023): how a number is shown depends on how it was measured.
 * A value nobody reported is never shown as 0.
 */
type MetricQuality = "unknown" | "partial" | "estimated" | "native";

export interface MetricView {
  text: string;
  quality: MetricQuality;
  hint: string;
}

export function metricView(record: SessionRecord, which: "cost" | "tokens", format: (n: number) => string, legacyReal: boolean): MetricView {
  const m = record.metrics;
  // An older hub (fleet peer) without metrics: the adapter's capability decides, as before.
  const quality: MetricQuality = m ? m[which] : legacyReal ? "native" : "unknown";
  const value = which === "cost" ? record.costUsd : record.tokensEst;
  const turns = m?.counters.turns ?? 0;
  const withValue = which === "cost" ? (m?.counters.costTurns ?? 0) : (m?.counters.tokenTurns ?? 0);
  switch (quality) {
    case "unknown":
      return { text: "nicht gemeldet", quality, hint: "Der Harness meldet diesen Wert nicht — das ist keine 0." };
    case "partial":
      return { text: `mind. ${format(value)}`, quality, hint: `Nur ${withValue} von ${turns} Zügen haben einen Wert gemeldet.` };
    case "estimated":
      return { text: `≈ ${format(value)}`, quality, hint: "Geschätzt (Preistabelle bzw. Näherung), nicht vom Anbieter gemeldet." };
    case "native":
      return { text: format(value), quality, hint: "Vom Anbieter gemeldet." };
  }
}

/** Today's cost: a sum with unknown parts is a lower bound. */
export function totalCostText(sessions: SessionRecord[], format: (n: number) => string): string {
  const sum = sessions.reduce((s, r) => s + r.costUsd, 0);
  const complete = sessions.length > 0 && sessions.every((r) => r.metrics?.cost === "native");
  if (sessions.length === 0) return format(0);
  if (sum === 0 && !complete) return "nicht gemeldet";
  return complete ? format(sum) : `mind. ${format(sum)}`;
}
