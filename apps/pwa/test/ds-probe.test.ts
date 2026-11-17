import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * EPIC-P63 AC-P63-8 — Probe unter e2e/fixtures/ds-probe/ muss die Ratchet-
 * Regeln ohne Allowlist bestehen: keine rohen UI-Klassen, keine Farbliterale,
 * keine var()-Fallbacks, z-index/Schrift nur über Tokens, jede Klasse hat
 * eine Regel (eigene CSS oder ui-*-Baustein-Präfix).
 */

const ROOT = resolve(import.meta.dirname, "../../..");
const PROBE = join(ROOT, "e2e/fixtures/ds-probe");
const STYLES = join(ROOT, "apps/pwa/src/app/styles");
const RAW = ["btn", "chip", "card", "empty", "empty-state", "overlay-sheet"] as const;

function probeFiles(ext: RegExp): string[] {
  return readdirSync(PROBE)
    .filter((n) => ext.test(n))
    .map((n) => join(PROBE, n));
}

function definedClasses(): Set<string> {
  const defined = new Set<string>();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name));
      else if (e.name.endsWith(".css")) {
        const css = readFileSync(join(dir, e.name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
        for (const m of css.matchAll(/\.([A-Za-z0-9_-]+)/g)) defined.add(m[1]!);
      }
    }
  };
  walk(STYLES);
  for (const f of probeFiles(/\.css$/)) {
    const css = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of css.matchAll(/\.([A-Za-z0-9_-]+)/g)) defined.add(m[1]!);
  }
  return defined;
}

describe("EPIC-P63 ds-probe (AC-P63-8)", () => {
  it("keine rohen btn/chip/card/empty/overlay-sheet-Klassen", () => {
    const raw: Record<string, number> = Object.fromEntries(RAW.map((r) => [r, 0]));
    for (const f of probeFiles(/\.tsx$/)) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/"([^"]*)"/g)) {
        for (const token of m[1]!.trim().split(/\s+/)) if ((RAW as readonly string[]).includes(token)) raw[token]! += 1;
      }
    }
    expect(raw).toEqual(Object.fromEntries(RAW.map((r) => [r, 0])));
  });

  it("CSS ohne Hex/rgb/hsl, ohne var-Fallback, z-index und Schrift nur über Tokens", () => {
    for (const f of probeFiles(/\.css$/)) {
      const css = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(css.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g) ?? []).toEqual([]);
      expect(css.match(/var\(--[a-z0-9-]+\s*,/g) ?? []).toEqual([]);
      for (const line of css.split("\n")) {
        if (/z-index\s*:/.test(line)) expect(line).toMatch(/z-index\s*:\s*var\(--z-[a-z-]+\)/);
        if (/font-size\s*:/.test(line)) expect(line).not.toMatch(/[0-9](\.\d+)?(px|em)\b/);
      }
    }
  });

  it("jede Probe-Klasse hat eine Regel oder ui-/ds-probe-Präfix — ohne Allowlist", () => {
    const defined = definedClasses();
    const missing = new Set<string>();
    for (const f of probeFiles(/\.tsx$/)) {
      const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      // class="…" und h(…, { class: "…" }) / class: '…'
      for (const m of src.matchAll(/class(?:=|:)\s*["']([^"']*)["']/g)) {
        for (const t of m[1]!.trim().split(/\s+/)) {
          if (!t) continue;
          if (!defined.has(t) && !t.startsWith("ui-") && !t.startsWith("ds-probe")) missing.add(t);
        }
      }
    }
    expect([...missing].sort()).toEqual([]);
  });

  it("Probe importiert Bausteine aus shared/ui", () => {
    const tsx = probeFiles(/\.tsx$/).map((f) => readFileSync(f, "utf8")).join("\n");
    expect(tsx).toMatch(/shared\/ui/);
    for (const name of ["Button", "Chip", "Card", "EmptyState", "Sheet"]) {
      expect(tsx).toContain(name);
    }
  });
});
