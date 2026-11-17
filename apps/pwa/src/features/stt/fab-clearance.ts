import { FAB_SIZE, type FabPos } from "./fab-position.ts";

/** Rechtwinkel in Viewport-Koordinaten. */
export interface FabRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FabClearance {
  /** Wo der FAB hin darf; `null` = nirgends frei, er soll verschwinden. */
  pos: FabPos | null;
  /** true, wenn er von seiner Grundposition aus weichen musste. */
  moved: boolean;
}

/**
 * BUG-0199: der FAB ist global und meidet bisher nur den Dock senkrecht (BUG-0138). Auf
 * langen Seiten ohne Dock (Einstellungen, Freigaben) wandern Bedienelemente beim Scrollen
 * unter seine 64×64-Flaeche und sind nicht mehr erreichbar. Diese Funktion sucht einen
 * freien Platz in der Naehe der gewuenschten Position — senkrecht zuerst, dann seitwaerts;
 * findet sie keinen, kommt `null` — der FAB verschwindet dann lieber, als dass er ein
 * Control verdeckt (auf dicht gepackten Abschnitten war sonst selbst nach zwei Schritten
 * senkrecht nichts frei, gemessen bei Scroll 3200 px auf dem produktiven Hub).
 *
 * Die Pruefung, ob eine Stelle belegt ist, kommt vom Aufrufer (DOM-Trefferprobe), damit
 * die Rechenregel ohne Browser testbar bleibt.
 */
export function placeFabAvoiding(
  pos: FabPos,
  blockedAt: (r: FabRect) => boolean,
  vw: number,
  vh: number,
  size = FAB_SIZE,
  margin = 8,
): FabClearance {
  const rect = (p: FabPos): FabRect => ({ x: p.x, y: p.y, w: size, h: size });
  if (!blockedAt(rect(pos))) return { pos, moved: false };

  const step = size + margin;
  // Erst eine eigene Kantenlaenge hoch/runter (die Seite hat meist frei), dann seitwaerts,
  // dann diagonal, zuletzt zwei Kantenlaengen senkrecht — immer nah am Nutzerplatz bleiben.
  const kandidaten: [number, number][] = [
    [0, -step],
    [0, step],
    [-step, 0],
    [step, 0],
    [-step, -step],
    [step, -step],
    [-step, step],
    [step, step],
    [0, -2 * step],
    [0, 2 * step],
  ];
  for (const [dx, dy] of kandidaten) {
    const cand: FabPos = { x: pos.x + dx, y: pos.y + dy };
    if (cand.y < margin || cand.y + size > vh - margin) continue;
    if (cand.x < margin || cand.x + size > vw - margin) continue;
    if (!blockedAt(rect(cand))) return { pos: cand, moved: true };
  }
  return { pos: null, moved: false };
}
