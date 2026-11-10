import type { GraphEdge, GraphGroup, GraphNode } from "@ancientvoid/contracts";

/** EPIC-P48 (ADR-0062 §3.4): deterministische Kraftrelaxation für den Repo-Graph.
 * Rein und ohne DOM — gleiche Eingabe, gleiche Ausgabe (Seed aus Pfad-Hash),
 * damit Layout-Entscheidungen in Tests nachgeprüft werden können. */

export interface LayoutPoint {
  x: number;
  y: number;
}

const ITERATIONS_MAX = 300;
const ITERATIONS_PER_RAF = 8;
const MOVE_MINIMUM = 0.04;
const SECTOR: Record<GraphGroup, [number, number]> = {
  doc: [0.28, 0.28],
  code: [0.72, 0.34],
  config: [0.26, 0.76],
  other: [0.76, 0.78],
};
const SPRING_REST = 90;
const SPRING_K = 0.02;
const REPEL_K = 2600;
const CENTER_K = 0.0015;
const PAD = 26;

/** FNV-1a — kurzer, stabiler Pfad-Hash als RNG-Saat. */
function hashPath(path: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < path.length; i++) {
    h ^= path.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Layout einmalig berechnen und dann einfrieren. Abstoßung läuft über uniforme
 * Gitter-Bucketung (O(n) pro Iteration), Kanten als Federn, schwache Zentrierung.
 * Startpositionen: vier Gruppensektoren, damit Doc/Code/Config lesbar getrennt liegen.
 */
export function computeLayout(nodes: GraphNode[], edges: GraphEdge[], width: number, height: number): Map<string, LayoutPoint> {
  const out = new Map<string, LayoutPoint>();
  if (nodes.length === 0 || width <= 0 || height <= 0) return out;
  // Saat aus den (sortierten) Pfaden: unabhängig von Knotenreihenfolge und Array-Identität.
  const seedPath = nodes.map((n) => n.path).sort().join("\n");
  const rand = mulberry32(hashPath(seedPath));

  const xs = new Float64Array(nodes.length);
  const ys = new Float64Array(nodes.length);
  const fx = new Float64Array(nodes.length);
  const fy = new Float64Array(nodes.length);
  const index = new Map<string, number>();
  for (let i = 0; i < nodes.length; i++) {
    index.set(nodes[i].path, i);
    const [sx, sy] = SECTOR[nodes[i].group] ?? SECTOR.other;
    const jitterR = Math.min(width, height) * 0.16 * Math.sqrt(rand());
    const jitterA = rand() * Math.PI * 2;
    xs[i] = sx * width + Math.cos(jitterA) * jitterR;
    ys[i] = sy * height + Math.sin(jitterA) * jitterR;
  }

  // Federn als Indexpaare; Kanten auf unbekannte Ziele fallen einfach weg.
  const springs: [number, number][] = [];
  for (const e of edges) {
    const a = index.get(e.from);
    const b = index.get(e.to);
    if (a !== undefined && b !== undefined && a !== b) springs.push([a, b]);
  }

  const bucket = Math.max(48, Math.sqrt((width * height) / Math.max(1, nodes.length)) * 1.4);
  const cols = Math.max(1, Math.ceil(width / bucket));
  const rows = Math.max(1, Math.ceil(height / bucket));
  const cellOf = (x: number, y: number): number => {
    const cx = Math.min(cols - 1, Math.max(0, Math.floor(x / bucket)));
    const cy = Math.min(rows - 1, Math.max(0, Math.floor(y / bucket)));
    return cy * cols + cx;
  };
  const cells: number[][] = Array.from({ length: cols * rows }, () => []);

  for (let iter = 0; iter < ITERATIONS_MAX; iter += ITERATIONS_PER_RAF) {
    // ~8 Entspannungsschritte pro rAF-Chunk; Bewegungsminimum beendet früher.
    let settled = false;
    for (let step = 0; step < ITERATIONS_PER_RAF && iter + step < ITERATIONS_MAX; step++) {
      for (const cell of cells) cell.length = 0;
      for (let i = 0; i < nodes.length; i++) cells[cellOf(xs[i], ys[i])].push(i);

      fx.fill(0);
      fy.fill(0);
      // Abstoßung nur gegen Nachbarzellen — gleiche Physik wie alle-gegen-alle
      // bei großen Abständen, aber O(n) statt O(n²).
      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          const here = cells[cy * cols + cx];
          if (here.length === 0) continue;
          for (let ny = cy; ny <= Math.min(rows - 1, cy + 1); ny++) {
            for (let nx = Math.max(0, cx - 1); nx <= Math.min(cols - 1, cx + 1); nx++) {
              const other = cells[ny * cols + nx];
              const same = ny === cy && nx === cx;
              for (let ai = 0; ai < here.length; ai++) {
                const a = here[ai];
                for (let bi = same ? ai + 1 : 0; bi < other.length; bi++) {
                  const b = other[bi];
                  let dx = xs[a] - xs[b];
                  let dy = ys[a] - ys[b];
                  let d2 = dx * dx + dy * dy;
                  if (d2 < 1) {
                    dx = rand() - 0.5;
                    dy = rand() - 0.5;
                    d2 = dx * dx + dy * dy + 0.5;
                  }
                  if (d2 > bucket * bucket * 4) continue;
                  const f = REPEL_K / d2;
                  const d = Math.sqrt(d2);
                  const ux = dx / d;
                  const uy = dy / d;
                  fx[a] += ux * f;
                  fy[a] += uy * f;
                  fx[b] -= ux * f;
                  fy[b] -= uy * f;
                }
              }
            }
          }
        }
      }
      for (const [a, b] of springs) {
        const dx = xs[b] - xs[a];
        const dy = ys[b] - ys[a];
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - SPRING_REST) * SPRING_K;
        const ux = (dx / d) * f;
        const uy = (dy / d) * f;
        fx[a] += ux;
        fy[a] += uy;
        fx[b] -= ux;
        fy[b] -= uy;
      }
      let move = 0;
      for (let i = 0; i < nodes.length; i++) {
        fx[i] += (width / 2 - xs[i]) * CENTER_K;
        fy[i] += (height / 2 - ys[i]) * CENTER_K;
        const cap = 12;
        const mx = Math.max(-cap, Math.min(cap, fx[i]));
        const my = Math.max(-cap, Math.min(cap, fy[i]));
        xs[i] = Math.max(PAD, Math.min(width - PAD, xs[i] + mx));
        ys[i] = Math.max(PAD, Math.min(height - PAD, ys[i] + my));
        move += Math.abs(mx) + Math.abs(my);
      }
      if (move / nodes.length < MOVE_MINIMUM) {
        settled = true;
        break;
      }
    }
    if (settled) break;
  }

  // Abschluss: in die Fläche einpassen — wenige Knoten füllen sonst nur die Mitte,
  // viele behalten ihren relativen Abstand (Deckel 1.6 gegen Über-Zoom).
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < nodes.length; i++) {
    if (xs[i] < minX) minX = xs[i];
    if (xs[i] > maxX) maxX = xs[i];
    if (ys[i] < minY) minY = ys[i];
    if (ys[i] > maxY) maxY = ys[i];
  }
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  const fit = Math.min((width - 2 * PAD) / bw, (height - 2 * PAD) / bh, 1.6);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  for (let i = 0; i < nodes.length; i++) out.set(nodes[i].path, { x: width / 2 + (xs[i] - cx) * fit, y: height / 2 + (ys[i] - cy) * fit });
  return out;
}
