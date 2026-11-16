/**
 * EPIC-P52 T52.2: Kamera, Detailstufen und Namensplatzierung der Galaxie —
 * rein, damit Zoomgrenzen und „Namen überdecken sich nicht“ testbar sind.
 */

export interface Camera {
  scale: number;
  tx: number;
  ty: number;
}

export const SCALE_MIN = 0.02;
export const SCALE_MAX = 8;
export const FLIGHT_MS = 500;

const clampScale = (scale: number) => Math.min(SCALE_MAX, Math.max(SCALE_MIN, scale));

/** Kreis (Weltkoordinaten) mittig in die Fläche einpassen, mit Rand. */
export function fitCircle(cx: number, cy: number, radius: number, width: number, height: number, margin = 24): Camera {
  const scale = clampScale((Math.min(width, height) - 2 * margin) / (2 * Math.max(radius, 1)));
  return { scale, tx: width / 2 - cx * scale, ty: height / 2 - cy * scale };
}

/**
 * fern: Systeme, Kerne, gebündelte Filamente · mittel: alle Sterne, Namen der
 * stärksten · nah: Namen aller sichtbaren Sterne. Schwelle = Bildschirmabstand
 * zweier Nachbarsterne (14 Welt-Einheiten).
 */
export type Detail = "far" | "mid" | "near";
export function detailLevel(scale: number): Detail {
  return scale < 0.4 ? "far" : scale < 1.2 ? "mid" : "near";
}

/** Zoom um einen Bildschirmpunkt — der Weltpunkt unter dem Zeiger bleibt stehen. */
export function zoomAt(cam: Camera, sx: number, sy: number, nextScale: number): Camera {
  const scale = clampScale(nextScale);
  return { scale, tx: sx - ((sx - cam.tx) * scale) / cam.scale, ty: sy - ((sy - cam.ty) * scale) / cam.scale };
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Zwischenstand eines Kameraflugs; Zoom verläuft logarithmisch, sonst wirkt er ruckartig. */
export function flightAt(from: Camera, to: Camera, t: number, width: number, height: number): Camera {
  const k = ease(Math.min(1, Math.max(0, t)));
  const scale = Math.exp(Math.log(from.scale) + (Math.log(to.scale) - Math.log(from.scale)) * k);
  // Den Weltpunkt in der Bildmitte interpolieren, nicht die Verschiebung — sonst schwenkt die Kamera beim Zoomen aus.
  const cx0 = (width / 2 - from.tx) / from.scale, cy0 = (height / 2 - from.ty) / from.scale;
  const cx1 = (width / 2 - to.tx) / to.scale, cy1 = (height / 2 - to.ty) / to.scale;
  const cx = cx0 + (cx1 - cx0) * k, cy = cy0 + (cy1 - cy0) * k;
  return { scale, tx: width / 2 - cx * scale, ty: height / 2 - cy * scale };
}

export interface LabelCandidate {
  text: string;
  x: number;
  y: number;
  /** Höher = wichtiger, wird zuerst platziert. */
  priority: number;
}
export interface PlacedLabel extends LabelCandidate {
  width: number;
  height: number;
}

/** Wichtigere Namen zuerst; ein Name, der einen platzierten überdecken würde, entfällt. */
export function placeLabels(candidates: LabelCandidate[], measure: (text: string) => number, height: number, limit = 300): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  const order = [...candidates].sort((a, b) => b.priority - a.priority || (a.text < b.text ? -1 : 1));
  for (const c of order) {
    if (placed.length >= limit) break;
    const width = measure(c.text);
    const box = { left: c.x - width / 2, right: c.x + width / 2, top: c.y - height, bottom: c.y };
    const hit = placed.some((p) => !(box.right < p.x - p.width / 2 || box.left > p.x + p.width / 2 || box.bottom < p.y - p.height || box.top > p.y));
    if (!hit) placed.push({ ...c, width, height });
  }
  return placed;
}

export const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
