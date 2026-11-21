// Tier A. Pilot 2 der Skill-Kur (EPIC-P72 T72.11): deterministisches sort/uniq-c.
import { describe, it, expect } from "vitest";
import { sortLines } from "./sort.mjs";

describe("sort (Pilot T72.4-Muster)", () => {
  it("positive: Byteordnung, locale-unabhängig", () => {
    const r = sortLines("b\nA\na\nB");
    expect(r.code).toBe(0);
    expect(r.lines).toEqual(["A", "B", "a", "b"]);
  });

  it("-c: Histogramm count desc, Ties in Byteordnung (deterministisch)", () => {
    const r = sortLines("apfel\nbanane\napfel\nApfel\nbanane\napfel", { count: true });
    expect(r.code).toBe(0);
    expect(r.lines).toEqual(["3 apfel", "2 banane", "1 Apfel"]);
  });

  it("negativ: leerer Input und Undefined → Exit 2", () => {
    expect(sortLines(undefined, {}).code).toBe(2);
    expect(sortLines("", {}).code).toBe(2);
  });

  it("deterministisch: gleicher Input → bytegenau gleicher Output", () => {
    const a = sortLines("z\nz\na", { count: true });
    const b = sortLines("a\nz\nz", { count: true });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.lines).toEqual(["2 z", "1 a"]);
  });
});
