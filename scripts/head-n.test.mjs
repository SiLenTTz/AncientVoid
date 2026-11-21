// Tier A. Pilot 1 der Skill-Kur (EPIC-P72 T72.11): deterministisches head-n.
import { describe, it, expect } from "vitest";
import { headN } from "./head-n.mjs";

const TEXT = Array.from({ length: 15 }, (_, i) => `zeile ${i + 1}`).join("\n");

describe("head-n (Pilot T72.4-Muster)", () => {
  it("positive: die ersten N Zeilen, Standard 10", () => {
    const r = headN(TEXT, { n: 3 });
    expect(r.code).toBe(0);
    expect(r.lines).toEqual(["zeile 1", "zeile 2", "zeile 3"]);
  });

  it("gekürzt: Rest-Zeilenzahl wird ausgewiesen", () => {
    const r = headN(TEXT, {});
    expect(r.lines.slice(0, 2)).toEqual(["zeile 1", "zeile 2"]);
    expect(r.truncated).toBe(5);
  });

  it("negativ: fehlender Inhalt/Parameterfehler → Exit 2", () => {
    expect(headN(null, { n: 3 }).code).toBe(2);
    expect(headN(TEXT, { n: 0 }).code).toBe(2);
    expect(headN(TEXT, { n: -1 }).code).toBe(2);
  });

  it("deterministisch: gleicher Input → bytegenau gleicher Output", () => {
    const a = headN("b\n a\nc", {});
    const b = headN("b\n a\nc", {});
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.lines).toEqual(["b", " a", "c"]);
  });
});
