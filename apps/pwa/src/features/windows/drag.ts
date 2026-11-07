/**
 * EPIC-P34 T34.11 (ADR-0053): die Ziehgeste, soweit der Spike sie belegt. Chromium hält die Nutzeraktion nach dem Drücken
 * aktiv, also darf das Loslassen außerhalb des Fensters `window.open` auslösen. Rein, damit es ohne Browser testbar ist.
 */
export function pointerOutside(x: number, y: number, view: { width: number; height: number }): boolean {
  return x < 0 || y < 0 || x > view.width || y > view.height;
}

export interface DropPoint {
  /** Bildschirmkoordinaten der Abwurfstelle (`screenX`/`screenY`). */
  left: number;
  top: number;
}

/**
 * Fenstermerkmale für `window.open`. Unter Wayland setzt der Compositor die Position (Hyprland: Fensterregel), `left`/`top`
 * wirken dort nicht — das schadet nicht; auf X11, Windows und macOS landet das Fenster an der Abwurfstelle.
 */
export function dropFeatures(drop: DropPoint | undefined): string {
  const base = "popup,noopener,noreferrer";
  if (!drop || !Number.isFinite(drop.left) || !Number.isFinite(drop.top)) return base;
  return `${base},left=${Math.round(drop.left)},top=${Math.round(drop.top)},width=960,height=720`;
}
