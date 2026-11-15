/**
 * EPIC-P59 (ADR-0078): minimal parser for the Prometheus text format —
 * zeilenbasiert, eigener Code (Prometheus-Import bleibt verneint, ADR-0010).
 * liefert Familie → Werte ihrer Samples; label-getrennte Samples einer
 * Familie bleiben als Einträge erhalten (Feldkatalog: Summe je Familie).
 */

export function parsePrometheus(text: string): Map<string, number[]> {
  const families = new Map<string, number[]>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{[^}]*\})?\s+(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(trimmed);
    if (!match?.[1] || match[2] === undefined) continue;
    const value = Number(match[2]);
    if (!Number.isFinite(value)) continue;
    const bucket = families.get(match[1]);
    if (bucket) bucket.push(value);
    else families.set(match[1], [value]);
  }
  return families;
}
