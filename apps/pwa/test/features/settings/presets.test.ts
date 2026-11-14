import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE } from "../../../src/app/appearance.ts";
import { surfaceForTheme, defaultPreset, parsePreset, clampWindow } from "../../../src/features/settings/presets.ts";

describe("P43.5 Geräte-Presets", () => {
  it("roundtrips only appearance and geometry, preserving separate text/code sizes", () => {
    const p = defaultPreset();
    p.appearance = { ...DEFAULT_APPEARANCE, fontScale: 1.2 };
    p.codeScale = 0.9;
    expect(parsePreset(JSON.stringify(p))).toEqual(p);
  });
  it.each([
    { version: 9 }, { css: "body{}" }, { token: "private" }, { ok: "#ffffff" },
    { background: "https://example.com/x.png" }, { background: "data:image/svg+xml;base64,PHN2Zz4=" },
    { radius: 999 }, { codeScale: 0 }, { surface: "#ffffff" },
    { appearance: { ...DEFAULT_APPEARANCE, fontCode: "inter" } },
    { appearance: { ...DEFAULT_APPEARANCE, accent: { dark: "#08090b", light: null } } },
  ])("rejects unsafe/unknown/low-contrast fields %j", (patch) => {
    expect(() => parsePreset(JSON.stringify({ ...defaultPreset(), ...patch }))).toThrow();
  });
  it("migrates unversioned local appearance without losing font selection", () => {
    const p = parsePreset(JSON.stringify({ ...DEFAULT_APPEARANCE, fontUi: "atkinson" }));
    expect(p.version).toBe(1);
    expect(p.appearance.fontUi).toBe("atkinson");
  });
  it("clamps windows onto a smaller display", () => {
    expect(clampWindow({ left: 4000, top: -90, width: 1600, height: 1200 }, { width: 390, height: 844 })).toEqual({ left: 0, top: 0, width: 390, height: 844 });
  });
});

it("window layouts contain validated targets and migrate without geometry loss", () => {
  const p = { ...defaultPreset(), windows: [{ target: { kind: "tool", page: "settings" }, geometry: { left: 3000, top: 2000, width: 960, height: 720 } }] };
  expect(parsePreset(JSON.stringify(p)).windows).toEqual(p.windows);
  expect(() => parsePreset(JSON.stringify({ ...p, windows: [{ target: { kind: "tool", page: "invalid" }, geometry: p.windows[0]!.geometry }] }))).toThrow();
});

it("a theme switch cannot reuse an unreadable surface from the other theme", () => {
  expect(surfaceForTheme("#121316", "dark")).toBe("#121316");
  expect(surfaceForTheme("#121316", "light")).toBeNull();
});
