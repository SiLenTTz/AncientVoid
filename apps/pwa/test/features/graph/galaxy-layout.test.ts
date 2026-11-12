import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode } from "@ancientvoid/contracts";
import { areaOf, galaxyLayout, MIN_STAR_DISTANCE, REST_SYSTEM, ROOT_SYSTEM, SYSTEM_GAP, type GalaxyLayout } from "../../../src/features/graph/galaxy-layout.ts";

/** EPIC-P52 T52.1 / AC-P52-1: rund, in Systeme gegliedert, Mindestabstand, keine Überlappung, deterministisch. */

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Synthetisches Repo: Pakete, Apps, Doku, Wurzel, kleine Bereiche; Kanten bevorzugt im eigenen Bereich. */
function repo(files: number, seed = 1): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const rand = rng(seed);
  const areas = ["packages/core/src", "packages/contracts/src", "apps/pwa/src", "apps/hub/src", "docs", "e2e/specs", "scripts", "", "tiny", "mini/x"];
  const weights = [0.3, 0.12, 0.25, 0.15, 0.08, 0.05, 0.03, 0.01, 0.005, 0.005];
  const paths: string[] = [];
  for (let i = 0; i < files; i++) {
    let pick = rand();
    let k = 0;
    while (k < weights.length - 1 && pick > weights[k]!) { pick -= weights[k]!; k++; }
    const area = areas[k]!;
    paths.push(`${area ? `${area}/` : ""}f${i}.ts`);
  }
  const byArea = new Map<string, string[]>();
  for (const p of paths) {
    const list = byArea.get(areaOf(p));
    if (list) list.push(p);
    else byArea.set(areaOf(p), [p]);
  }
  const edges: GraphEdge[] = [];
  for (let i = 0; i < files * 1.5; i++) {
    const from = paths[Math.floor(rand() * files)]!;
    const sameArea = byArea.get(areaOf(from))!;
    const to = rand() < 0.7 ? sameArea[Math.floor(rand() * sameArea.length)]! : paths[Math.floor(rand() * files)]!;
    if (from !== to) edges.push({ from, to, kind: "import" });
  }
  const degree = new Map<string, { in: number; out: number }>(paths.map((p) => [p, { in: 0, out: 0 }]));
  for (const e of edges) { degree.get(e.from)!.out++; degree.get(e.to)!.in++; }
  const nodes = paths.map((path) => ({ path, group: "code" as const, bytes: 100, entry: false, ...degree.get(path)! }));
  return { nodes, edges };
}

/** Kleinster Abstand zweier Sterne, über ein Raster (sonst O(n²) bei 10 000). */
function minDistance(layout: GalaxyLayout): number {
  const cell = MIN_STAR_DISTANCE * 2;
  const grid = new Map<string, [number, number][]>();
  let min = Infinity;
  for (const { x, y } of layout.stars.values()) {
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const [px, py] of grid.get(`${cx + dx},${cy + dy}`) ?? []) min = Math.min(min, Math.hypot(px - x, py - y));
    }
    const key = `${cx},${cy}`;
    const list = grid.get(key);
    if (list) list.push([x, y]);
    else grid.set(key, [[x, y]]);
  }
  return min;
}

const serialize = (layout: GalaxyLayout) => JSON.stringify({ stars: [...layout.stars].sort(([a], [b]) => (a < b ? -1 : 1)), systems: layout.systems, links: layout.links, radius: layout.radius });

describe("Galaxie-Layout (EPIC-P52 T52.1)", () => {
  it("Bereichsregel: packages/x und apps/x, sonst erstes Segment, Wurzel eigen", () => {
    expect(areaOf("packages/core/src/a.ts")).toBe("packages/core");
    expect(areaOf("apps/pwa/index.html")).toBe("apps/pwa");
    expect(areaOf("packages/README.md")).toBe("packages");
    expect(areaOf("docs/adr/0001.md")).toBe("docs");
    expect(areaOf("README.md")).toBe(ROOT_SYSTEM);
  });

  it("Bereiche unter vier Dateien wandern ins Sammelsystem „Übriges“", () => {
    const { nodes, edges } = repo(400);
    const layout = galaxyLayout(nodes, edges);
    const ids = layout.systems.map((s) => s.id);
    expect(ids).toContain("packages/core");
    expect(ids).toContain(REST_SYSTEM);
    expect(ids).not.toContain("tiny");
    for (const s of layout.systems) if (s.id !== REST_SYSTEM) expect(s.files.length).toBeGreaterThanOrEqual(4);
    expect(layout.stars.get(nodes.find((n) => n.path.startsWith("tiny/"))!.path)!.system).toBe(REST_SYSTEM);
  });

  for (const files of [1, 7, 400, 4000, 10_000]) {
    it(`${files} Dateien: Mindestabstand, Sterne im eigenen System, Systeme überlappen nicht`, () => {
      const { nodes, edges } = repo(files, files);
      const layout = galaxyLayout(nodes, edges);
      expect(layout.stars.size).toBe(files);
      if (files > 1) expect(minDistance(layout)).toBeGreaterThanOrEqual(MIN_STAR_DISTANCE - 1e-9);
      const byId = new Map(layout.systems.map((s) => [s.id, s]));
      for (const star of layout.stars.values()) {
        const s = byId.get(star.system)!;
        expect(Math.hypot(star.x - s.x, star.y - s.y)).toBeLessThan(s.radius);
      }
      for (let i = 0; i < layout.systems.length; i++) for (let j = i + 1; j < layout.systems.length; j++) {
        const a = layout.systems[i]!;
        const b = layout.systems[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(a.radius + b.radius + SYSTEM_GAP - 1e-6);
      }
      for (const s of layout.systems) expect(Math.hypot(s.x, s.y) + s.radius).toBeLessThanOrEqual(layout.radius + 1e-6);
    }, 60_000);
  }

  it("deterministisch: andere Reihenfolge von Knoten und Kanten ergibt byte-gleiche Positionen", () => {
    const { nodes, edges } = repo(1500, 7);
    const shuffle = <T,>(list: T[], seed: number) => { const r = rng(seed); return list.map((v) => [r(), v] as const).sort((a, b) => a[0] - b[0]).map(([, v]) => v); };
    expect(serialize(galaxyLayout(shuffle(nodes, 3), shuffle(edges, 4)))).toBe(serialize(galaxyLayout(nodes, edges)));
  });

  it("das am stärksten nach außen verbundene System liegt in der Mitte; die Gesamtform ist rund", () => {
    const { nodes, edges } = repo(4000, 11);
    const layout = galaxyLayout(nodes, edges);
    expect(layout.systems[0]).toMatchObject({ x: 0, y: 0 });
    const xs = [...layout.stars.values()].map((s) => s.x);
    const ys = [...layout.stars.values()].map((s) => s.y);
    const ratio = (Math.max(...xs) - Math.min(...xs)) / (Math.max(...ys) - Math.min(...ys));
    expect(ratio).toBeGreaterThan(0.6);
    expect(ratio).toBeLessThan(1 / 0.6);
  });

  it("Kernsterne sind die gradstärksten und liegen innen", () => {
    const { nodes, edges } = repo(400, 5);
    const layout = galaxyLayout(nodes, edges);
    const core = layout.systems.find((s) => s.id === "packages/core")!;
    const dist = (p: string) => { const s = layout.stars.get(p)!; return Math.hypot(s.x - core.x, s.y - core.y); };
    const inner = core.files.filter((p) => layout.stars.get(p)!.core);
    const outer = core.files.filter((p) => !layout.stars.get(p)!.core);
    expect(inner.length).toBeGreaterThan(0);
    expect(Math.max(...inner.map(dist))).toBeLessThan(Math.max(...outer.map(dist)));
    const degree = new Map(nodes.map((n) => [n.path, n.in + n.out]));
    expect(Math.min(...inner.map((p) => degree.get(p)!))).toBeGreaterThanOrEqual(Math.max(...outer.map((p) => degree.get(p)!)));
  });

  it("gebündelte Verbindungen zählen nur Kanten zwischen Systemen", () => {
    const nodes: GraphNode[] = ["a/1", "a/2", "a/3", "a/4", "b/1", "b/2", "b/3", "b/4"].map((path) => ({ path, group: "code", bytes: 1, in: 0, out: 0, entry: false }));
    const edges: GraphEdge[] = [{ from: "a/1", to: "a/2", kind: "import" }, { from: "a/1", to: "b/1", kind: "import" }, { from: "b/2", to: "a/3", kind: "link" }, { from: "a/1", to: "gibt/es-nicht", kind: "import" }];
    expect(galaxyLayout(nodes, edges).links).toEqual([{ a: "a", b: "b", count: 2 }]);
  });

  it("K2: 4000 Dateien in einem großzügigen Zeitbudget (Stolperdraht; Messlauf in T52.7)", () => {
    const { nodes, edges } = repo(4000, 13);
    galaxyLayout(nodes, edges);
    const t0 = performance.now();
    galaxyLayout(nodes, edges);
    expect(performance.now() - t0).toBeLessThan(600);
  });
});
