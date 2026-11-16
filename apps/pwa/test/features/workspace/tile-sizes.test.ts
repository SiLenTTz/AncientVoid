import { describe, expect, it } from "vitest";
import { emptyWorkspace, parseWorkspace, resizeTile, serializeWorkspace, setLayout, tileFractions } from "../../../src/features/workspace/tiles.ts";

describe("Kachelgrößen (QoL 2026-10-29, K2)", () => {
  it("ohne gespeicherte Größen gilt der Layout-Default (1+2 startet 1.35:1)", () => {
    expect(tileFractions(emptyWorkspace())).toEqual({ col: 0.5, row: 0.5, col2: 2 / 3 });
    const onePlusTwo = setLayout(emptyWorkspace(), "1+2");
    expect(tileFractions(onePlusTwo).col).toBeGreaterThan(0.55);
  });

  it("resizeTile klemmt auf 0.2–0.8 und behält die andere Achse", () => {
    const ws = resizeTile(emptyWorkspace(), "col", 0.95);
    expect(tileFractions(ws).col).toBe(0.8);
    const tiny = resizeTile(emptyWorkspace(), "row", 0.01);
    expect(tileFractions(tiny).row).toBe(0.2);
    const both = resizeTile(resizeTile(emptyWorkspace(), "col", 0.7), "row", 0.4);
    expect(tileFractions(both).col).toBe(0.7);
    expect(tileFractions(both).row).toBe(0.4);
    expect(tileFractions(both).col2).toBeCloseTo(0.8);
  });

  it("Größen überleben die Serialisierung und alte Speicher ohne sizes bleiben gültig", () => {
    const ws = resizeTile(resizeTile(setLayout(emptyWorkspace(), "2x2"), "col", 0.62), "row", 0.38);
    expect(parseWorkspace(serializeWorkspace(ws)).sizes).toEqual({ col: 0.62, row: 0.38 });
    const legacy = JSON.stringify({ layout: "2v", slots: [{ sessionId: "s1" }, null, null, null], focus: 0 });
    const parsed = parseWorkspace(legacy);
    expect(parsed.layout).toBe("2v");
    expect(parsed.sizes).toBeUndefined();
    expect(tileFractions(parsed)).toEqual({ col: 0.5, row: 0.5, col2: 2 / 3 });
  });

  it("kaputte sizes-Werte fallen auf den Default zurück", () => {
    const junk = JSON.stringify({ layout: "2v", slots: [null, null, null, null], focus: 0, sizes: { col: "breit", row: null } });
    expect(tileFractions(parseWorkspace(junk))).toEqual({ col: 0.5, row: 0.5, col2: 2 / 3 });
  });

  it("3v startet drittelgleich; col2 überlebt Serialisierung und bleibt rechts von col", () => {
    const ws = resizeTile(resizeTile(setLayout(emptyWorkspace(), "3v"), "col", 0.3), "col2", 0.6);
    expect(tileFractions(ws)).toEqual({ col: 0.3, row: 0.5, col2: 0.6 });
    expect(tileFractions(parseWorkspace(serializeWorkspace(ws)))).toEqual({ col: 0.3, row: 0.5, col2: 0.6 });
    expect(tileFractions(setLayout(emptyWorkspace(), "3v"))).toEqual({ col: 1 / 3, row: 0.5, col2: 2 / 3 });
    const crossed = resizeTile(ws, "col", 0.8);
    const f = tileFractions(crossed);
    expect(f.col).toBe(0.8);
    expect(f.col2).toBeGreaterThanOrEqual(f.col + 0.1);
  });
});
