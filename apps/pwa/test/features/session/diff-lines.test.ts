import { describe, expect, it } from "vitest";
import { diffLineClass, isOneSided, pairHunkLines } from "../../../src/features/session/diff-lines.ts";

describe("pairHunkLines", () => {
  it("stellt Löschungen und Hinzufügungen eines Blocks Zeile für Zeile nebeneinander", () => {
    const rows = pairHunkLines(" gleich\n-alt1\n-alt2\n+neu1\n gleich2");
    expect(rows.map((r) => [r.left.type, r.right.type])).toEqual([
      ["ctx", "ctx"],
      ["del", "add"],
      ["del", "empty"],
      ["ctx", "ctx"],
    ]);
  });
});

describe("isOneSided (EPIC-P20 T20.1)", () => {
  it("eine neue Datei (nur Hinzufügungen) ist einseitig, damit sie die ganze Breite nutzt", () => {
    expect(isOneSided(pairHunkLines("+a\n+b\n+c"))).toBe(true);
  });

  it("eine gelöschte Datei (nur Löschungen) ist einseitig", () => {
    expect(isOneSided(pairHunkLines("-a\n-b"))).toBe(true);
  });

  it("Kontext oder ein ersetzter Block hat zwei Seiten", () => {
    expect(isOneSided(pairHunkLines(" kontext\n+neu"))).toBe(false);
    expect(isOneSided(pairHunkLines("-alt\n+neu"))).toBe(false);
  });

  it("ein leerer Hunk ist nicht einseitig", () => {
    expect(isOneSided([])).toBe(false);
  });
});

describe("diffLineClass", () => {
  it("ordnet Zeilen ihrer Art zu", () => {
    expect(diffLineClass("+x")).toBe("diff-line-add");
    expect(diffLineClass("-x")).toBe("diff-line-del");
    expect(diffLineClass("@@ -1 +1 @@")).toBe("diff-line-hunk");
    expect(diffLineClass("+++ b/x")).toBe("diff-line-file");
    expect(diffLineClass(" x")).toBe("diff-line-ctx");
  });
});
