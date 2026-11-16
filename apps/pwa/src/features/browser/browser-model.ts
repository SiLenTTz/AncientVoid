import { BrowserTestCase, type BrowserTestState } from "@ancientvoid/contracts";

/** EPIC-P39 (ADR-0059): reine Hilfen des Browser-Panels — ohne DOM, damit unit-testbar. */

/** Klick auf das skalierte Standbild → Koordinaten im Viewport der Seite. */
export function toViewportPoint(click: { x: number; y: number }, box: { left: number; top: number; width: number; height: number }, natural: { width: number; height: number }): { x: number; y: number } | null {
  if (box.width <= 0 || box.height <= 0 || natural.width <= 0 || natural.height <= 0) return null;
  const rx = (click.x - box.left) / box.width;
  const ry = (click.y - box.top) / box.height;
  if (rx < 0 || rx > 1 || ry < 0 || ry > 1) return null;
  return { x: Math.round(rx * natural.width), y: Math.round(ry * natural.height) };
}

export const TEST_STATE_LABEL: Record<BrowserTestState, string> = {
  running: "läuft",
  passed: "bestanden",
  failed: "fehlgeschlagen",
  aborted: "abgebrochen",
  unknown: "unbekannt",
};

export const EXAMPLE_TEST = JSON.stringify(
  { name: "Startseite zeigt Titel", viewport: "desktop", steps: [{ type: "goto", url: "/", timeoutMs: 5000 }, { type: "expectVisible", selector: "h1", timeoutMs: 3000 }] },
  null,
  2,
);

/** Testfall aus dem Editor — mit verständlicher Fehlermeldung statt rohem Zod-Dump. */
export function parseTestCase(text: string): { ok: true; test: BrowserTestCase } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `Kein gültiges JSON: ${err instanceof Error ? err.message : "Syntaxfehler"}` };
  }
  const parsed = BrowserTestCase.safeParse(raw);
  if (parsed.success) return { ok: true, test: parsed.data };
  const issue = parsed.error.issues[0];
  return { ok: false, error: `Ungültiger Testfall: ${issue?.path.join(".") || "Wurzel"} — ${issue?.message ?? "unbekannt"}` };
}
