/**
 * EPIC-P59 / ADR-0078 Nachtrag: Halogen (peonist flash-server) hat kein
 * Prometheus-`/metrics`. `/health` liefert Queue/Busy/Slots — Quelle
 * „gemeldet“, nie als 0 erfinden.
 */

export interface HalogenHealthRaw {
  /** Rohfamilien für den Sampler-Ring (key → Zahl). */
  raw: Record<string, number>;
  /** true, wenn die JSON-Antwort wie Halogen aussieht. */
  recognized: boolean;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Parst eine Halogen-`/health`-JSON-Antwort in Sampler-Rohwerte. */
export function parseHalogenHealth(body: string): HalogenHealthRaw {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return { raw: {}, recognized: false };
  }
  if (!data || typeof data !== "object") return { raw: {}, recognized: false };
  const obj = data as Record<string, unknown>;
  const looksLike =
    obj.status === "ok" ||
    typeof obj.model === "string" ||
    (obj.version !== undefined && (obj.queued !== undefined || obj.in_flight !== undefined || obj.slots !== undefined));
  if (!looksLike) return { raw: {}, recognized: false };

  const raw: Record<string, number> = {};
  const queued = num(obj.queued);
  const inFlight = num(obj.in_flight);
  const busyFor = num(obj.busy_for_s);
  const slots = num(obj.slots);
  const context = num(obj.context);
  const kv = num(obj.kv_pool_positions);
  if (queued !== undefined) raw["halogen:queued"] = queued;
  if (inFlight !== undefined) raw["halogen:in_flight"] = inFlight;
  if (typeof obj.busy === "boolean") raw["halogen:busy"] = obj.busy ? 1 : 0;
  if (busyFor !== undefined) raw["halogen:busy_for_s"] = busyFor;
  if (slots !== undefined) raw["halogen:slots"] = slots;
  if (context !== undefined) raw["halogen:context"] = context;
  if (kv !== undefined) raw["halogen:kv_pool_positions"] = kv;
  return { raw, recognized: true };
}
