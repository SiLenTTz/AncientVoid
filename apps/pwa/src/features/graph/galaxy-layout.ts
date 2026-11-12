import type { GraphEdge, GraphNode } from "@ancientvoid/contracts";

/**
 * EPIC-P52 T52.1: der Repo-Graph als Galaxie. Bereiche aus dem Pfad werden zu
 * Sternsystemen (Kern + zwei Spiralarme), die Systeme liegen rund um das am
 * stärksten nach außen verbundene. Rein und deterministisch: gleiche Knoten und
 * Kanten ergeben byte-gleiche Positionen, unabhängig von Reihenfolge und
 * Fenstergröße — die Zeichenfläche geht erst in die Kamera ein.
 */

/** Kein Stern liegt näher an einem anderen (Weltkoordinaten). */
export const MIN_STAR_DISTANCE = 14;
/** Freiraum zwischen den Rändern zweier Systeme. */
export const SYSTEM_GAP = MIN_STAR_DISTANCE * 3;
/** Kleinere Bereiche wandern ins Sammelsystem. */
export const MIN_SYSTEM_FILES = 4;
export const ROOT_SYSTEM = "·";
export const REST_SYSTEM = "…";

export interface GalaxyStar {
  x: number;
  y: number;
  system: string;
  core: boolean;
}

export interface GalaxySystem {
  id: string;
  label: string;
  x: number;
  y: number;
  radius: number;
  /** Pfade nach Rang: Grad absteigend, dann Pfad. */
  files: string[];
}

/** Gebündelte Verbindung zwischen zwei Systemen (a < b), Stärke = Anzahl Kanten. */
export interface GalaxyLink {
  a: string;
  b: string;
  count: number;
}

export interface GalaxyLayout {
  stars: Map<string, GalaxyStar>;
  systems: GalaxySystem[];
  links: GalaxyLink[];
  /** Umkreis um den Ursprung, der alle Systeme enthält — für die Kamera. */
  radius: number;
}

/** Bereichsregel (bewusst nicht konfigurierbar): `packages/x`, `apps/x`, sonst erstes Segment. */
export function areaOf(path: string): string {
  const parts = path.split("/");
  if (parts.length === 1) return ROOT_SYSTEM;
  if ((parts[0] === "packages" || parts[0] === "apps") && parts.length > 2) return `${parts[0]}/${parts[1]}`;
  return parts[0]!;
}

export function systemLabel(id: string): string {
  return id === ROOT_SYSTEM ? "Wurzel" : id === REST_SYSTEM ? "Übriges" : id;
}

/** FNV-1a — stabile Saat aus Text. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
const unit = (text: string) => hash(text) / 4294967296;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const ARM_PITCH = 0.34;
/** Halbe Armbreite: Sterne liegen nebeneinander im Arm, nicht auf einer Linie. */
const ARM_HALF_WIDTH = MIN_STAR_DISTANCE * 1.8;

/** Raster für Abstandsprüfungen: Zellgröße = Mindestabstand, also reichen die 3×3 Nachbarzellen. */
class StarGrid {
  private readonly cells = new Map<string, [number, number][]>();
  private key(cx: number, cy: number): string { return `${cx},${cy}`; }
  free(x: number, y: number): boolean {
    const cx = Math.floor(x / MIN_STAR_DISTANCE);
    const cy = Math.floor(y / MIN_STAR_DISTANCE);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const [px, py] of this.cells.get(this.key(cx + dx, cy + dy)) ?? []) {
          if ((px - x) ** 2 + (py - y) ** 2 < MIN_STAR_DISTANCE ** 2) return false;
        }
      }
    }
    return true;
  }
  add(x: number, y: number): void {
    const k = this.key(Math.floor(x / MIN_STAR_DISTANCE), Math.floor(y / MIN_STAR_DISTANCE));
    const cell = this.cells.get(k);
    if (cell) cell.push([x, y]);
    else this.cells.set(k, [[x, y]]);
  }
}

/** Sterne eines Systems um den Ursprung: Kern als Sonnenblumen-Scheibe, Rest auf zwei Armen. */
function placeSystem(id: string, files: string[]): { local: [number, number][]; radius: number; coreCount: number } {
  const grid = new StarGrid();
  const local: [number, number][] = [];
  const coreCount = Math.min(files.length, Math.max(3, Math.min(60, Math.round(files.length * 0.25))));
  const spin = unit(id) * Math.PI * 2;
  const step = MIN_STAR_DISTANCE * 1.15;
  let coreRadius = MIN_STAR_DISTANCE;
  const place = (x: number, y: number) => { grid.add(x, y); local.push([x, y]); };
  for (let k = 0; k < coreCount; k++) {
    // Vogel-Spirale; liegt ein Platz zu nah, wandert der Stern nach außen, bis er frei ist.
    for (let n = k; ; n++) {
      const r = step * Math.sqrt(n + 0.5);
      const a = spin + n * GOLDEN_ANGLE;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (grid.free(x, y)) { place(x, y); coreRadius = Math.max(coreRadius, r); break; }
    }
  }
  const theta = [0, 0];
  for (let j = coreCount; j < files.length; j++) {
    const arm = (j - coreCount) % 2;
    const wobble = (unit(files[j]!) * 2 - 1) * ARM_HALF_WIDTH;
    for (;;) {
      const t = theta[arm] ?? 0;
      const r = (coreRadius + step) * Math.exp(ARM_PITCH * t);
      const a = spin + arm * Math.PI + t;
      theta[arm] = t + (step * 0.45) / r;
      const x = Math.cos(a) * (r + wobble);
      const y = Math.sin(a) * (r + wobble);
      if (grid.free(x, y)) { place(x, y); break; }
    }
  }
  let radius = MIN_STAR_DISTANCE;
  for (const [x, y] of local) radius = Math.max(radius, Math.hypot(x, y));
  return { local, radius: radius + MIN_STAR_DISTANCE, coreCount };
}

/** Systemkreise anordnen: Startspirale nach Rang, wenige Relaxationsschritte, danach überlappungsfrei. */
function arrangeSystems(ids: string[], radii: Map<string, number>, weight: (a: string, b: string) => number): Map<string, [number, number]> {
  const pos = new Map<string, [number, number]>();
  ids.forEach((id, i) => {
    const r = i === 0 ? 0 : (radii.get(ids[0]!)! + SYSTEM_GAP) * Math.sqrt(i) * 1.2;
    pos.set(id, [Math.cos(i * GOLDEN_ANGLE) * r, Math.sin(i * GOLDEN_ANGLE) * r]);
  });
  const separate = () => {
    let moved = false;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = pos.get(ids[i]!)!;
        const b = pos.get(ids[j]!)!;
        const need = radii.get(ids[i]!)! + radii.get(ids[j]!)! + SYSTEM_GAP;
        let dx = b[0] - a[0];
        let dy = b[1] - a[1];
        let d = Math.hypot(dx, dy);
        if (d >= need) continue;
        if (d < 1e-6) { dx = Math.cos(j); dy = Math.sin(j); d = 1; }
        const push = (need - d) / d;
        // Das zentrale System bleibt stehen; sonst teilen sich beide den Weg.
        if (i === 0) { b[0] += dx * push; b[1] += dy * push; }
        else { a[0] -= dx * push / 2; a[1] -= dy * push / 2; b[0] += dx * push / 2; b[1] += dy * push / 2; }
        moved = true;
      }
    }
    return moved;
  };
  for (let iter = 0; iter < 40; iter++) {
    // Verbundene Systeme ziehen sich an, alle leicht zur Mitte — danach wieder trennen.
    for (let i = 1; i < ids.length; i++) {
      const p = pos.get(ids[i]!)!;
      let fx = -p[0] * 0.02;
      let fy = -p[1] * 0.02;
      for (let j = 0; j < ids.length; j++) {
        if (i === j) continue;
        const w = weight(ids[i]!, ids[j]!);
        if (w === 0) continue;
        const q = pos.get(ids[j]!)!;
        const k = Math.min(0.08, 0.01 * Math.log1p(w));
        fx += (q[0] - p[0]) * k;
        fy += (q[1] - p[1]) * k;
      }
      p[0] += fx;
      p[1] += fy;
    }
    separate();
  }
  for (let guard = 0; guard < 500 && separate(); guard++);
  return pos;
}

export function galaxyLayout(nodes: GraphNode[], edges: GraphEdge[]): GalaxyLayout {
  const sorted = [...nodes].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const known = new Set(sorted.map((n) => n.path));
  const byArea = new Map<string, GraphNode[]>();
  for (const node of sorted) {
    const area = areaOf(node.path);
    const list = byArea.get(area);
    if (list) list.push(node);
    else byArea.set(area, [node]);
  }
  const systemOf = new Map<string, string>();
  const members = new Map<string, GraphNode[]>();
  for (const [area, list] of byArea) {
    const id = list.length < MIN_SYSTEM_FILES ? REST_SYSTEM : area;
    for (const node of list) systemOf.set(node.path, id);
    members.set(id, [...(members.get(id) ?? []), ...list]);
  }

  const linkCount = new Map<string, number>();
  const outward = new Map<string, number>();
  for (const e of edges) {
    if (!known.has(e.from) || !known.has(e.to)) continue;
    const a = systemOf.get(e.from)!;
    const b = systemOf.get(e.to)!;
    if (a === b) continue;
    const key = a < b ? `${a}\n${b}` : `${b}\n${a}`;
    linkCount.set(key, (linkCount.get(key) ?? 0) + 1);
    outward.set(a, (outward.get(a) ?? 0) + 1);
    outward.set(b, (outward.get(b) ?? 0) + 1);
  }
  const ids = [...members.keys()].sort((a, b) => (outward.get(b) ?? 0) - (outward.get(a) ?? 0) || (a < b ? -1 : a > b ? 1 : 0));

  const placed = new Map<string, { files: string[]; local: [number, number][]; radius: number; coreCount: number }>();
  for (const id of ids) {
    const files = members.get(id)!
      .sort((a, b) => b.in + b.out - (a.in + a.out) || (a.path < b.path ? -1 : 1))
      .map((n) => n.path);
    placed.set(id, { files, ...placeSystem(id, files) });
  }
  const radii = new Map([...placed].map(([id, p]) => [id, p.radius]));
  const weight = (a: string, b: string) => linkCount.get(a < b ? `${a}\n${b}` : `${b}\n${a}`) ?? 0;
  const centers = arrangeSystems(ids, radii, weight);

  const stars = new Map<string, GalaxyStar>();
  const systems: GalaxySystem[] = [];
  let radius = 0;
  for (const id of ids) {
    const p = placed.get(id)!;
    const [cx, cy] = centers.get(id)!;
    p.files.forEach((path, i) => {
      const [lx, ly] = p.local[i]!;
      stars.set(path, { x: cx + lx, y: cy + ly, system: id, core: i < p.coreCount });
    });
    systems.push({ id, label: systemLabel(id), x: cx, y: cy, radius: p.radius, files: p.files });
    radius = Math.max(radius, Math.hypot(cx, cy) + p.radius);
  }
  const links = [...linkCount].map(([key, count]) => {
    const [a, b] = key.split("\n") as [string, string];
    return { a, b, count };
  }).sort((x, y) => y.count - x.count || (x.a + x.b < y.a + y.b ? -1 : 1));
  return { stars, systems, links, radius };
}
