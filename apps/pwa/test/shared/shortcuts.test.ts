import { describe, expect, it } from "vitest";
import { CATALOG, matchesCombo, normalizeKey, type ShortcutInfo } from "../../src/shared/shortcuts/registry.ts";

/** EPIC-P51 T51.5: Fail loud bei Kürzel-Konflikten — der Katalog ist die eine Wahrheit. */
describe("Shortcut-Registry Katalog (P51)", () => {
  it("hat nur eindeutige IDs", () => {
    const ids = CATALOG.map((s) => s.id);
    expect(new Set(ids).size, `doppelte IDs: ${ids.join(", ")}`).toBe(ids.length);
  });

  it("kennt keine doppelte Combo im selben Scope — außer Overlay-Esc (mutuell exklusiv)", () => {
    const byScope = new Map<string, ShortcutInfo[]>();
    for (const s of CATALOG) {
      const list = byScope.get(s.scope) ?? [];
      list.push(s);
      byScope.set(s.scope, list);
    }
    for (const [scope, list] of byScope) {
      const seen = new Map<string, number>();
      for (const s of list) {
        seen.set(s.combo, (seen.get(s.combo) ?? 0) + 1);
      }
      for (const [combo, n] of seen) {
        // Esc schließt jeweils das EINE aktive Overlay (Registrierung nur wenn offen);
        // alle anderen Combos dürfen pro Scope genau einmal existieren.
        if (scope === "overlay" && combo === "Esc") continue;
        expect(n, `${scope}: ${combo} ist ${n}× im Katalog`).toBe(1);
      }
    }
  });

  it("führt Combos in kanonischer Form (Modifikator groß, Hauptkey zuletzt)", () => {
    for (const s of CATALOG) {
      expect(s.combo, s.id).toMatch(/^(Ctrl(\+Shift)?\+|Alt(\+Shift)?\+)?[A-Za-z0-9]+$/);
      expect(s.label.length, s.id).toBeGreaterThan(0);
      expect(s.description.length, s.id).toBeGreaterThan(0);
    }
  });

  it("localOnly-Kürzel nennen ihren Ausführungsort (Cheat-Sheet)", () => {
    for (const s of CATALOG) if (s.localOnly) expect(s.where, s.id).toBeTruthy();
  });
});

/** Matching: die Muster der Migration 1:1 — physische Aliase wie zuvor. */
describe("matchesCombo (P51)", () => {
  const key = (key: string, opts: Partial<KeyboardEvent> & { code?: string } = {}): KeyboardEvent =>
    ({ key, code: opts.code ?? key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...opts }) as unknown as KeyboardEvent;

  it("Strg+ Plus/Minus über aliastastaten (=, _ und Zehnertastatur-Add)", () => {
    const zoomIn = CATALOG.find((s) => s.id === "ui.zoom-in")!;
    expect(matchesCombo(zoomIn, key("=", { ctrlKey: true }))).toBe(true);
    expect(matchesCombo(zoomIn, key("+", { ctrlKey: true }))).toBe(true);
    expect(matchesCombo(zoomIn, key("Add", { ctrlKey: true }))).toBe(true);
    // lenientShift: „+“ liegt auf der Shift-Ebene (bisheriges scaleKey-Verhalten).
    expect(matchesCombo(zoomIn, key("=", { ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(matchesCombo(zoomIn, key("-", { ctrlKey: true }))).toBe(false);
    expect(matchesCombo(zoomIn, key("=", { altKey: true }))).toBe(false);
  });

  it("Strg+K toleriert Meta (Mac), K in jeder Case-Variante", () => {
    const cmd = CATALOG.find((s) => s.id === "command.toggle")!;
    expect(matchesCombo(cmd, key("k", { ctrlKey: true }))).toBe(true);
    expect(matchesCombo(cmd, key("K", { metaKey: true }))).toBe(true);
    expect(matchesCombo(cmd, key("k", { ctrlKey: true, shiftKey: true }))).toBe(false);
  });

  it("Alt+1 … Alt+Shift+4 unterscheiden Shift und Ziffer (Digit-Codes)", () => {
    const focus1 = CATALOG.find((s) => s.id === "workspace.tile-1")!;
    const swap1 = CATALOG.find((s) => s.id === "workspace.tile-swap-1")!;
    expect(matchesCombo(focus1, key("1", { altKey: true, code: "Digit1" }))).toBe(true);
    expect(matchesCombo(swap1, key("1", { altKey: true, shiftKey: true, code: "Digit1" }))).toBe(true);
    expect(matchesCombo(focus1, key("1", { altKey: true, shiftKey: true, code: "Digit1" }))).toBe(false);
    // Numpad war nie eine Tile-Taste und bleibt es nicht (1:1 zu e.code Digit).
    expect(matchesCombo(focus1, key("1", { altKey: true, code: "Numpad1" }))).toBe(false);
    // BUG-0071-E2E dispatcht synthetische Events nur mit code, ohne key.
    expect(matchesCombo(focus1, key("", { altKey: true, code: "Digit1" }))).toBe(true);
    expect(matchesCombo(CATALOG.find((s) => s.id === "workspace.layout")!, key("", { altKey: true, code: "KeyL" }))).toBe(true);
  });

  it("Alt+L nimmt Shift als Richtung (lenientShift), Alt+W nicht", () => {
    const layout = CATALOG.find((s) => s.id === "workspace.layout")!;
    const close = CATALOG.find((s) => s.id === "workspace.tile-close")!;
    expect(matchesCombo(layout, key("l", { altKey: true }))).toBe(true);
    expect(matchesCombo(layout, key("l", { altKey: true, shiftKey: true }))).toBe(true);
    expect(matchesCombo(close, key("w", { altKey: true }))).toBe(true);
    expect(matchesCombo(close, key("w", { altKey: true, shiftKey: true }))).toBe(false);
  });

  it("Esc matcht ohne Modifikator", () => {
    const esc = CATALOG.find((s) => s.id === "command.close")!;
    expect(matchesCombo(esc, key("Escape"))).toBe(true);
    expect(matchesCombo(esc, key("Escape", { ctrlKey: true }))).toBe(false);
  });

  it("normalizeKey bildet Layout-Aliase ab", () => {
    expect(normalizeKey(key("=", { code: "Equal" }))).toBe("Plus");
    expect(normalizeKey(key("_", { code: "Minus" }))).toBe("Minus");
    expect(normalizeKey(key("E", { code: "KeyE", shiftKey: true }))).toBe("e");
  });
});
