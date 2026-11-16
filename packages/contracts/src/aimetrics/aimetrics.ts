import { z } from "zod";

/**
 * EPIC-P59 (ADR-0078): Kennzahlen des lokalen KI-Servers — direct probes,
 * keine Aggregation (die bleibt P56). `null` heißt „nicht gemeldet“ und ist
 * nie eine 0 (ADR-0023); Quelle und Alter stehen an jeder Zahl.
 */

/** Ein Roh-Sample im Fensterspeicher (Ring-Buffer, volatil — ADR-0078). */
export const AiMetricsSample = z.object({
  ts: z.string(),
  value: z.number().nullable(),
});
export type AiMetricsSample = z.infer<typeof AiMetricsSample>;

/** p50/p95 über das eigene Sample-Fenster — Histogramme gibt es nicht (ADR-0078). */
export const AiMetricsWindowStats = z.object({
  windowSec: z.number().int().positive(),
  samples: z.number().int().min(0),
  p50: z.number().nullable(),
  p95: z.number().nullable(),
});
export type AiMetricsWindowStats = z.infer<typeof AiMetricsWindowStats>;

export const AiMetricsField = z.object({
  key: z.string(),
  label: z.string(),
  unit: z.string(),
  /** Quelle direkt an der Zahl (ADR-0023): gemeldet | sysfs | os | abgeleitet. */
  source: z.enum(["gemeldet", "sysfs", "os", "abgeleitet"]),
  /** null = „nicht gemeldet“ — nie eine 0 (ADR-0023). */
  value: z.number().nullable(),
  ts: z.string().nullable(),
  window: AiMetricsWindowStats.nullable(),
  history: z.array(AiMetricsSample).max(50_000),
});
export type AiMetricsField = z.infer<typeof AiMetricsField>;

export const AiMetricsSourceReport = z.object({
  id: z.string(),
  kind: z.enum(["model-server", "hub-host"]),
  label: z.string(),
  /** ohne Secret — Keys liegen nur als Datei-Referenz vor (ADR-0011). */
  url: z.string().nullable(),
  /** K9: ein fehlgeschlagene Probe ist ein Zustand, kein stiller Drop. */
  status: z.union([z.object({ ok: z.literal(true) }), z.object({ ok: z.literal(false), error: z.string() })]),
  lastSampleAt: z.string().nullable(),
  fields: z.array(AiMetricsField),
});
export type AiMetricsSourceReport = z.infer<typeof AiMetricsSourceReport>;

/** Antwort von `GET /api/aimetrics` (K5: REST, kein EventBus-Payload). */
export const AiMetricsReport = z.object({
  generatedAt: z.string(),
  intervalSec: z.number().int().positive(),
  windowSec: z.number().int().positive(),
  /** Diese Instanz — der Report zeigt immer nur ihre eigenen Quellen. */
  self: z.object({ hostLabel: z.string() }),
  sources: z.array(AiMetricsSourceReport),
});
export type AiMetricsReport = z.infer<typeof AiMetricsReport>;
