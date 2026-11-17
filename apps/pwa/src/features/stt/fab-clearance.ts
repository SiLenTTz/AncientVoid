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
 * freien Platz in der Naehe der gewuenschten Position; findet sie keinen, kommt `null` —
 * der FAB verschwindet dann lieber, als dass er ein Control verdeckt.
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
  // Erst eine eigene Kantenlaenge hoch/runter, dann zwei — nah am Nutzerplatz bleiben.
  for (const dy of [-step, step, -2 * step, 2 * step]) {
    const cand: FabPos = { x: pos.x, y: pos.y + dy };
    if (cand.y < margin || cand.y + size > vh - margin || cand.x + size > vw - margin) continue;
    if (!blockedAt(rect(cand))) return { pos: cand, moved: true };
  }
  return { pos: null, moved: false };
}
