import { describe, expect, it, vi } from "vitest";
import type { GraphEdge } from "@ancientvoid/contracts";
import { ROOT_CATEGORY, categoriesOf, loadGalaxyView, neighborInDirection, neighborsOf, saveGalaxyView, searchFiles } from "../../../src/features/graph/galaxy-query.ts";

const edges: GraphEdge[] = [
  { from: "src/main.ts", to: "src/auth.ts", kind: "import" },
  { from: "src/auth.ts", to: "README.md", kind: "link" },
  { from: "tools/check.py", to: "src/auth.ts", kind: "pyimport" },
];

describe("neighborsOf", () => {
  it("zählt jede Kante, eingehend und ausgehend getrennt", () => {
    const list = neighborsOf("src/auth.ts", edges, 1);
    const inn = list.filter((n) => n.dir === "in");
    const out = list.filter((n) => n.dir === "out");
    expect(inn.map((n) => n.path).sort()).toEqual(["src/main.ts", "tools/check.py"]);
    expect(out.map((n) => n.path)).toEqual(["README.md"]);
    expect(inn).toHaveLength(2);
    expect(out).toHaveLength(1);
  });

  it("zwei Schritte hängen den übernächsten Nachbarn an, ohne die Auswahl zu wiederholen", () => {
    const list = neighborsOf("src/main.ts", edges, 2);
    expect(list.map((n) => [n.path, n.hop])).toEqual([
      ["src/auth.ts", 1],
      ["README.md", 2],
      ["tools/check.py", 2],
    ]);
  });
});

describe("searchFiles", () => {
  const nodes = [{ path: "src/auth.ts" }, { path: "README.md" }, { path: "docs/auth-notes.md" }];

  it("stellt den Dateinamen vor den Pfad und lässt eine leere Anfrage leer", () => {
    expect(searchFiles(nodes, "  ")).toEqual([]);
    expect(searchFiles(nodes, "auth").map((h) => h.path)).toEqual(["src/auth.ts", "docs/auth-notes.md"]);
    expect(searchFiles(nodes, "README").map((h) => h.path)).toEqual(["README.md"]);
  });

  it("findet eine Teilfolge im Dateinamen", () => {
    expect(searchFiles(nodes, "ath").map((h) => h.path)[0]).toBe("src/auth.ts");
  });
});

describe("neighborInDirection", () => {
  const at = (path: string) => {
    const pos: Record<string, { x: number; y: number }> = {
      "src/auth.ts": { x: 0, y: 0 },
      "src/main.ts": { x: -10, y: 1 },
      "README.md": { x: 8, y: 0 },
      "tools/check.py": { x: 0, y: 12 },
    };
    return pos[path];
  };

  it("wählt den Nachbarn, der am besten in Blickrichtung liegt", () => {
    expect(neighborInDirection("src/auth.ts", edges, at, "left")).toBe("src/main.ts");
    expect(neighborInDirection("src/auth.ts", edges, at, "right")).toBe("README.md");
    expect(neighborInDirection("src/auth.ts", edges, at, "down")).toBe("tools/check.py");
    expect(neighborInDirection("src/auth.ts", edges, at, "up")).toBeNull();
  });
});

describe("Ansichtszustand", () => {
  it("rundet durch localStorage und verwirft Unbrauchbares", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
    });
    const target = "session=test-galaxy";
    saveGalaxyView(target, {
      camera: { scale: 1.5, tx: 10, ty: -4 },
      selected: "README.md",
      system: "src",
      twoHop: true,
      groups: ["code"],
      cats: ["bugs"],
      deadOnly: false,
      errorOnly: true,
    });
    expect(loadGalaxyView(target)?.selected).toBe("README.md");
    expect(loadGalaxyView(target)?.camera.scale).toBe(1.5);
    // BUG-0232: Kategorie-Filter überlebt den Roundtrip.
    expect(loadGalaxyView(target)?.cats).toEqual(["bugs"]);
    localStorage.setItem(`ancientvoid.galaxy:${target}`, "{");
    expect(loadGalaxyView(target)).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("BUG-0232 Kategorie-Bereiche", () => {
  it("categoriesOf erkennt Bereichs-Kategorien dynamisch, häufige zuerst", () => {
    const cats = categoriesOf([
      { category: "epics" },
      { category: "epics" },
      { category: "bugs" },
      { category: "bugs" },
      { category: "bugs" },
      { category: null },
      { path: "README.md" },
    ]);
    expect(cats).toEqual([
      { name: "bugs", count: 3 },
      { name: ROOT_CATEGORY, count: 2 },
      { name: "epics", count: 2 },
    ]);
    // Seltene Bereiche unter minCount fallen weg, Wurzeldateien bündeln sich unter (Wurzel).
    expect(categoriesOf([{ category: "x" }, { category: "y" }])).toEqual([]);
    expect(categoriesOf([{ category: null }, { category: null }, { category: null }])).toEqual([{ name: ROOT_CATEGORY, count: 3 }]);
    expect(categoriesOf([{ category: "x" }, { category: "x" }]).map((c) => c.name)).toEqual(["x"]);
  });
});
