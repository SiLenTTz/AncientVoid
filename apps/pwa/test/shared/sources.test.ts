import { describe, expect, it, beforeEach } from "vitest";
import { addSource, removeSource, sourcesBlock, sourcesOf, takeSources } from "../../src/shared/sources.ts";

/** EPIC-P43.5 T43.5-1: Quellenkorb (flüchtig, target-gebunden) und der K5-gekappte Prompt-Block. */

const page = () => {
  // sessionStorage existiert im Node-Kontext nicht — minimaler Stub wie im Browser.
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  (globalThis as Record<string, unknown>).window = { dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined };
};

describe("Quellenkorb (T43.5-1)", () => {
  beforeEach(page);

  it("addSource/removeSource/takeSources sind target-gebunden und idempotent pro ID", () => {
    addSource("s1", { id: "a", kind: "code", label: "a.ts:1–2", excerpt: null, hash: null });
    addSource("s1", { id: "a", kind: "code", label: "a.ts:1–2 (neu)", excerpt: null, hash: null });
    addSource("s2", { id: "b", kind: "test", label: "Run 7", excerpt: null, hash: null });
    expect(sourcesOf("s1").map((s) => s.label)).toEqual(["a.ts:1–2 (neu)"]);
    expect(sourcesOf("s2")).toHaveLength(1);
    expect(removeSource("s1", "a")).toHaveLength(0);
    addSource("s1", { id: "c", kind: "review", label: "r", excerpt: null, hash: null });
    expect(takeSources("s1").map((s) => s.id)).toEqual(["c"]);
    expect(sourcesOf("s1")).toHaveLength(0); // verbraucht
    expect(takeSources("s1")).toHaveLength(0); // doppelt nehmen bleibt leer
  });

  it("mehr als sechs Quellen: die ältesten fallen weg (K5-Schutz)", () => {
    for (let i = 0; i < 9; i++) addSource("s1", { id: `q${i}`, kind: "code", label: `f${i}.ts:1`, excerpt: null, hash: null });
    expect(sourcesOf("s1").map((s) => s.id)).toEqual(["q3", "q4", "q5", "q6", "q7", "q8"]);
  });

  it("kaputter Speicher bleibt leer statt zu werfen", () => {
    (globalThis as Record<string, unknown>).sessionStorage = {
      getItem: () => "{kein json",
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(sourcesOf("egal")).toEqual([]);
  });
});

describe("sourcesBlock (T43.5-1, K5)", () => {
  beforeEach(page);

  it("numerierte Zeilen mit Typ und Excerpt, eingefasst in <quellen>", () => {
    const block = sourcesBlock([
      { id: "1", kind: "code", label: "apps/a.ts:12–18", excerpt: "const x = 1;", hash: null },
      { id: "2", kind: "review", label: "Notiz zu b.md", excerpt: null, hash: null },
    ]);
    expect(block).toContain("<quellen>");
    expect(block).toContain("[1] Code — apps/a.ts:12–18");
    expect(block).toContain("«const x = 1;»");
    expect(block).toContain("[2] Review — Notiz zu b.md");
    expect(block.trim().endsWith("</quellen>")).toBe(true);
  });

  it("Exzerpte und Block bleiben unter der K5-Grenze", () => {
    const long = "x".repeat(5_000);
    const block = sourcesBlock([{ id: "1", kind: "code", label: "big", excerpt: long, hash: null }]);
    expect(block.length).toBeLessThanOrEqual(2048);
    expect(block).not.toContain(long);
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, kind: "test" as const, label: `t${i}`, excerpt: long, hash: null }));
    expect(sourcesBlock(many).length).toBeLessThanOrEqual(2048);
  });

  it("ohne Quellen gibt es keinen Block (kein Ghost-Marker im Prompt)", () => {
    expect(sourcesBlock([])).toBe("");
  });
});
