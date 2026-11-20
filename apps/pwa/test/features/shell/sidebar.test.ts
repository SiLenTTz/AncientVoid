import { describe, expect, it } from "vitest";
import { parseSidebar, SIDEBAR_ENTRIES } from "../../../src/features/shell/sidebar.ts";

describe("Sidebar-Vorlieben", () => {
  it("ordnet die Projektansicht zwischen Suchen und Session ein", () => {
    expect(parseSidebar(null).order.slice(0, 4)).toEqual(["dashboard", "search", "projects", "new"]);
  });
  it("ergänzt neue Einträge und verwirft unbekannte und doppelte IDs", () => {
    const prefs = parseSidebar(JSON.stringify({ order: ["terminal", "unknown", "terminal"], hidden: ["media", "unknown"], minimized: true }));
    expect(prefs.order[0]).toBe("terminal");
    expect(prefs.order).toHaveLength(SIDEBAR_ENTRIES.length);
    expect(prefs.hidden).toEqual(["media"]);
    expect(prefs.minimized).toBe(true);
    expect(parseSidebar(JSON.stringify(prefs))).toEqual(prefs);
  });
  it("übersteht beschädigte Werte, auch primitive JSON-Werte", () => {
    for (const raw of ["{", "null", "false", "42", '"string"', '{"order":null,"hidden":4}']) expect(parseSidebar(raw)).toEqual(parseSidebar(null));
  });
});
