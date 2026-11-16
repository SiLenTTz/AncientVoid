import { describe, expect, it } from "vitest";
import { dirLabel, groupDocs, snippetAnchor } from "../../../src/features/search/Search.tsx";
import type { ProjectDoc } from "../../../src/shared/api.ts";

const doc = (path: string, title: string | null = null): ProjectDoc => ({ path, title, bytes: 100 });

describe("Dokumentübersicht der Suchansicht", () => {
  it("gruppiert nach Verzeichnis, Stammverzeichnis zuerst", () => {
    const groups = groupDocs([doc("README.md", "Alpha"), doc("docs/adr/0001.md", "Erste"), doc("docs/guide.md", "Anleitung")]);
    expect(groups.map((g) => g.dir)).toEqual([".", "docs", "docs/adr"]);
    expect(groups[0]!.items).toEqual([doc("README.md", "Alpha")]);
    expect(groups[1]!.items.map((d) => d.path)).toEqual(["docs/guide.md"]);
  });

  it("das Stammverzeichnis heißt verständlich, Unterordner beim Pfadnamen", () => {
    expect(dirLabel(".")).toBe("Stammverzeichnis");
    expect(dirLabel("docs/adr")).toBe("docs/adr");
  });

  it("snippetAnchor normalisiert Whitespace und kürzt auf einen stabilen Kern", () => {
    expect(snippetAnchor("  Handoff   zwischen\nPC und Handy  ")).toBe("Handoff zwischen PC und Handy");
    expect(snippetAnchor(`${"x".repeat(100)} Ende`)).toHaveLength(60);
  });
});
