import { describe, expect, it } from "vitest";
import { wordDiff, wordMarksFor } from "../../../src/features/session/word-diff.ts";

describe("wortweise Diff-Segmente", () => {
  it("markiert nur die geaenderte Zahl, nicht die ganze Zeile", () => {
    const paar = wordDiff("Der Wert 1204 betraegt genau 3 Tage.", "Der Wert 1379 betraegt genau 4 Tage.");
    expect(paar).not.toBeNull();
    const { left, right } = paar!;
    expect(left.filter((s) => s.t === "del").map((s) => s.s.trim())).toEqual(["1204", "3"]);
    expect(right.filter((s) => s.t === "add").map((s) => s.s.trim())).toEqual(["1379", "4"]);
    // der Rest bleibt gemeinschaft und wird nicht angefasst
    expect(left.filter((s) => s.t === "eq").map((s) => s.s).join("")).toContain("Der Wert");
  });

  it("setzt die Zeile verlustfrei wieder zusammen", () => {
    const alt = "Zwei Schritte: 12 von 34 offen";
    const neu = "Zwei Schritte: 12 von 35 offen";
    const paar = wordDiff(alt, neu)!;
    expect(paar.left.map((s) => s.s).join("")).toBe(alt);
    expect(paar.right.map((s) => s.s).join("")).toBe(neu);
    expect(paar.right.filter((s) => s.t === "add").map((s) => s.s)).toEqual(["35"]);
  });

  it("findet hinzugefuegtes und entferntes Wort", () => {
    const paar = wordDiff("alpha beta gamma", "alpha neue beta gamma")!;
    expect(paar.right.some((s) => s.t === "add" && s.s.includes("neue"))).toBe(true);
    const weg = wordDiff("alpha beta gamma", "alpha gamma")!;
    expect(weg.left.some((s) => s.t === "del" && s.s.includes("beta"))).toBe(true);
    expect(weg.right.every((s) => s.t === "eq")).toBe(true);
  });

  it("laesst die Zeilendarstellung stehen, wo Wort-Diff nichts erklaert", () => {
    expect(wordDiff("gleich", "gleich")).toBeNull();
    expect(wordDiff("aaaa bbbb", "cccc dddd")).toBeNull();
    expect(wordDiff("", "irgendwas")).toBeNull();
    // zu viele Einzelaenderungen auf einer Zeile sind Rauschen
    expect(wordDiff("x a b c d e f g y", "x 1 2 3 4 5 6 7 y")).toBeNull();
    expect(wordDiff("x a b c d e f y", "x 1 2 3 4 5 6 y")).not.toBeNull();
  });

  it("paart nur echte Aenderungsblöcke gleicher Länge", () => {
    const marks = wordMarksFor([
      { type: "ctx", text: "drittens" },
      { type: "del", text: "Der Wert 1204 fest" },
      { type: "add", text: "Der Wert 1379 fest" },
      { type: "ctx", text: " Schluss" },
    ]);
    expect(marks[0]).toBeNull();
    expect(marks[1]!.some((s) => s.t === "del" && s.s.includes("1204"))).toBe(true);
    expect(marks[2]!.some((s) => s.t === "add" && s.s.includes("1379"))).toBe(true);
    expect(marks[3]).toBeNull();

    // drei raus, zwei rein: kein sauberes Paar -> keine Marker
    const unpaar = wordMarksFor([
      { type: "del", text: "Der Wert 1204 fest" },
      { type: "del", text: "eine zweite Zeile" },
      { type: "del", text: "und eine dritte" },
      { type: "add", text: "Der Wert 1379 fest" },
      { type: "add", text: "eine zweite Zeile wirklich" },
    ]);
    expect(unpaar.every((m) => m === null)).toBe(true);
  });
});
