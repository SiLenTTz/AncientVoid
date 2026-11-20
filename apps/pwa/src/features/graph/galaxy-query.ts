import type { GraphEdge, GraphEdgeKind, GraphGroup } from "@ancientvoid/contracts";
import type { Camera } from "./galaxy-view.ts";

/** Ein Nachbar in der Auswahlliste. `in` verweist auf die Auswahl, `out` geht von ihr aus. */
export interface GalaxyNeighbor {
  path: string;
  kind: GraphEdgeKind;
  dir: "in" | "out";
  hop: 1 | 2;
}

/** BUG-0232: Anzeigename für Dateien ohne Bereich (direkt in der Wurzel). */
export const ROOT_CATEGORY = "(Wurzel)";

export interface GalaxyCategory {
  name: string;
  count: number;
}

/** BUG-0232: Kategorie-Bereiche des gescannten Repos — dynamisch erkannt (z. B. epics, bugs),
 *  häufige zuerst, seltene (unter minCount) und der Rest über `limit` weggefiltert. */
export function categoriesOf(nodes: readonly { category?: string | null }[], minCount = 2, limit = 12): GalaxyCategory[] {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    const name = n.category ?? ROOT_CATEGORY;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts]
    .filter(([, count]) => count >= minCount)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

/**
 * Kanten der Auswahl, eine Zeile je Kante (damit die Länge mit `in`/`out` übereinstimmt).
 * Bei zwei Schritten zusätzlich je ein weiterer Knoten hinter jedem direkten Nachbarn.
 */
export function neighborsOf(path: string, edges: readonly GraphEdge[], hops: 1 | 2): GalaxyNeighbor[] {
  const direct: GalaxyNeighbor[] = [];
  for (const e of edges) {
    if (e.to === path) direct.push({ path: e.from, kind: e.kind, dir: "in", hop: 1 });
    else if (e.from === path) direct.push({ path: e.to, kind: e.kind, dir: "out", hop: 1 });
  }
  if (hops === 1) return direct;
  const seen = new Set<string>([path, ...direct.map((n) => n.path)]);
  const second: GalaxyNeighbor[] = [];
  for (const n of direct) {
    for (const e of edges) {
      const other = e.from === n.path ? e.to : e.to === n.path ? e.from : null;
      if (!other || seen.has(other)) continue;
      seen.add(other);
      second.push({ path: other, kind: e.kind, dir: n.dir, hop: 2 });
    }
  }
  return [...direct, ...second];
}

export interface SearchHit {
  path: string;
  score: number;
}

/** Dateiname vor vollem Pfad, Teilstring vor Teilfolge. Leer bei leerer Anfrage. */
export function searchFiles(nodes: readonly { path: string }[], query: string, limit = 40): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const n of nodes) {
    const path = n.path.toLowerCase();
    const slash = path.lastIndexOf("/");
    const name = slash < 0 ? path : path.slice(slash + 1);
    const nameAt = name.indexOf(q);
    if (nameAt >= 0) hits.push({ path: n.path, score: 2000 - nameAt });
    else {
      const pathAt = path.indexOf(q);
      if (pathAt >= 0) hits.push({ path: n.path, score: 1000 - pathAt });
      else {
        const fuzzy = subsequence(name, q);
        if (fuzzy > 0) hits.push({ path: n.path, score: fuzzy });
      }
    }
  }
  hits.sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path));
  return hits.slice(0, limit);
}

function subsequence(text: string, q: string): number {
  let i = 0;
  let last = -2;
  let gap = 0;
  for (let c = 0; c < text.length && i < q.length; c++) {
    if (text[c] === q[i]) {
      if (last >= 0 && c > last + 1) gap += c - last - 1;
      last = c;
      i++;
    }
  }
  return i < q.length ? 0 : Math.max(1, 80 - gap);
}

export type Compass = "left" | "right" | "up" | "down";

const AXIS: Record<Compass, readonly [number, number]> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  down: [0, 1],
};

/** Nächster direkter Nachbar in Blickrichtung (y wächst nach unten). */
export function neighborInDirection(
  path: string,
  edges: readonly GraphEdge[],
  at: (path: string) => { x: number; y: number } | undefined,
  dir: Compass,
): string | null {
  const here = at(path);
  if (!here) return null;
  const [dx, dy] = AXIS[dir];
  let best: string | null = null;
  let bestScore = 0.35;
  const seen = new Set<string>();
  for (const n of neighborsOf(path, edges, 1)) {
    if (seen.has(n.path)) continue;
    seen.add(n.path);
    const p = at(n.path);
    if (!p) continue;
    const vx = p.x - here.x;
    const vy = p.y - here.y;
    const len = Math.hypot(vx, vy);
    if (len < 1e-6) continue;
    const align = (vx / len) * dx + (vy / len) * dy;
    if (align > bestScore) {
      bestScore = align;
      best = n.path;
    }
  }
  return best;
}

export interface GalaxyViewState {
  camera: Camera;
  selected: string | null;
  system: string | null;
  twoHop: boolean;
  groups: GraphGroup[];
  /** BUG-0232: aktive Kategorie-Filter (Anzeigenamen, siehe categoriesOf). */
  cats: string[];
  deadOnly: boolean;
  errorOnly: boolean;
}

const storageKey = (target: string) => `ancientvoid.galaxy:${target}`;

export function loadGalaxyView(target: string): GalaxyViewState | null {
  try {
    const raw = localStorage.getItem(storageKey(target));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<GalaxyViewState>;
    if (!v.camera || typeof v.camera.scale !== "number") return null;
    return {
      camera: v.camera,
      selected: typeof v.selected === "string" ? v.selected : null,
      system: typeof v.system === "string" ? v.system : null,
      twoHop: v.twoHop === true,
      groups: Array.isArray(v.groups) ? v.groups : [],
      cats: Array.isArray(v.cats) ? v.cats : [],
      deadOnly: v.deadOnly === true,
      errorOnly: v.errorOnly === true,
    };
  } catch {
    return null;
  }
}

export function saveGalaxyView(target: string, state: GalaxyViewState): void {
  try {
    localStorage.setItem(storageKey(target), JSON.stringify(state));
  } catch {
    // Privater Modus oder voller Speicher: die Karte bleibt, nur der Stand nicht.
  }
}
