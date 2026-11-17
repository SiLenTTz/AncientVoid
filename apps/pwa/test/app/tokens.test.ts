import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CALL_COLOR, contrastRatio, DEFAULT_ACCENT } from "../../src/app/appearance.ts";

/**
 * EPIC-P43 T43.1 (AC-P43-4) + EPIC-P63 T63.1: die Farb-Tokens beider
 * Erscheinungsbilder, direkt aus dem Stylesheet gelesen. Text braucht 4,5:1
 * auf Hintergrund und Kartenfläche. Seit P63 liegen die Tokens in
 * `00-tokens.css` in drei Schichten (Primitiv → Semantik); der Test löst
 * Semantik über Primitive zu Hex-Werten auf.
 */
const css = readFileSync(resolve(import.meta.dirname, "../../src/app/styles/00-tokens.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} fehlt`).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf("\n}", start));
  return Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}

const ROOT = block(":root");
/** Semantik → Primitiv → Hex auflösen (eine Verweisebene, color-mix bleibt offen). */
function resolveHex(tokens: Record<string, string>, name: string): string | undefined {
  const value = tokens[name];
  if (!value) return undefined;
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  const alias = value.match(/^var\((--[a-z0-9-]+)\)$/);
  return alias ? resolveHex(tokens, alias[1]!) : undefined;
}

const THEMES = {
  dunkel: Object.fromEntries(Object.entries(ROOT).map(([k]) => [k, resolveHex(ROOT, k)])) as Record<string, string | undefined>,
  hell: (() => {
    const light = { ...ROOT, ...block('[data-theme="light"]') };
    return Object.fromEntries(Object.keys(light).map((k) => [k, resolveHex(light, k)])) as Record<string, string | undefined>;
  })(),
};

/** Farben, die als Text auf --bg und --bg-elev stehen. */
const TEXT = ["--fg", "--fg-dim", "--fg-faint", "--accent", "--call", "--info", "--err", "--code-keyword", "--code-string", "--code-number", "--code-title", "--code-type"];
/** Fläche und ihre Schriftfarbe. */
const INK: [string, string][] = [["--accent", "--accent-ink"], ["--call", "--call-ink"], ["--info", "--info-ink"]];

describe.each(Object.entries(THEMES))("Farb-Tokens, %s", (name, t) => {
  it.each(TEXT)("%s erreicht als Text 4,5:1 auf Hintergrund und Karte", (token) => {
    expect(t[token], `${token} fehlt oder ist nicht als Hex auflösbar`).toBeTruthy();
    for (const surface of ["--bg", "--bg-elev"]) expect(contrastRatio(t[token]!, t[surface]!), `${token} auf ${surface}`).toBeGreaterThanOrEqual(4.5);
  });

  it.each(INK)("Schrift auf %s erreicht 4,5:1", (surface, ink) => {
    expect(contrastRatio(t[ink]!, t[surface]!)).toBeGreaterThanOrEqual(4.5);
  });

  it("Zustandsfarben sind auf der Karte als Zeichen erkennbar (3:1)", () => {
    for (const token of ["--ok", "--warn", "--err", "--call", "--info"]) expect(contrastRatio(t[token]!, t["--bg-elev"]!), token).toBeGreaterThanOrEqual(3);
  });

  it("Ruf und Akzent sind getrennte, deutlich verschiedene Farben", () => {
    expect(t["--call"]).not.toBe(t["--accent"]);
    const [a, c] = [t["--accent"]!, t["--call"]!].map((hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)));
    expect(Math.hypot(a![0]! - c![0]!, a![1]! - c![1]!, a![2]! - c![2]!)).toBeGreaterThan(80);
  });

  it("appearance.ts kennt dieselben Standardwerte wie das Stylesheet", () => {
    const key = name === "dunkel" ? "dark" : "light";
    expect(DEFAULT_ACCENT[key]).toBe(t["--accent"]);
    expect(CALL_COLOR[key]).toBe(t["--call"]);
  });

  it("Light überschreibt nur die Semantik-Schicht — keine neuen Hex-Werte", () => {
    if (name !== "hell") return;
    const lightBlock = block('[data-theme="light"]');
    for (const [name, value] of Object.entries(lightBlock)) {
      expect(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/.test(value), `${name} trägt ein Farbliteral statt eines Primitive-Verweises`).toBe(false);
    }
  });
});

describe("--ok und --warn im hellen Erscheinungsbild (EPIC-P43 AC-P43-4)", () => {
  it("--ok erreicht als Text 4,5:1 auf Hintergrund und Karte; --warn auf der Karte", () => {
    const t = THEMES.hell;
    for (const surface of ["--bg", "--bg-elev"] as const) {
      expect(contrastRatio(t["--ok"]!, t[surface]!), `--ok auf ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio(t["--warn"]!, t["--bg-elev"]!)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("EPIC-P63 T63.0/BUG-0187: jedes benutzte var(--x) ist definiert", () => {
  it("keine unbekannten Tokens in styles/ und TSX (Ratchet siehe css-ratchet.json)", () => {
    const stylesDir = resolve(import.meta.dirname, "../../src/app/styles");
    const srcDir = resolve(import.meta.dirname, "../../src");
    const cssAll = readdirSync(stylesDir, { recursive: true })
      .map((f) => join(stylesDir, String(f)))
      .filter((f) => f.endsWith(".css"))
      .map((f) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, ""))
      .join("\n");
    const tsAll = readdirSync(srcDir, { recursive: true })
      .map((f) => join(srcDir, String(f)))
      .filter((f) => /\.[jt]sx?$/.test(f))
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");

    const defined = new Set<string>();
    for (const m of cssAll.matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(m[1]!);
    for (const m of tsAll.matchAll(/setProperty\(\s*"(-{2}[a-z0-9-]+)"/g)) defined.add(m[1]!);
    for (const m of tsAll.matchAll(/"(-{2}[a-z0-9-]+)"\s*:/g)) defined.add(m[1]!);
    for (const m of tsAll.matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(m[1]!);

    const used = new Map<string, number>();
    for (const m of `${cssAll}\n${tsAll}`.matchAll(/var\((--[a-z0-9-]+)/g)) used.set(m[1]!, (used.get(m[1]!) ?? 0) + 1);
    const unknown = [...used.entries()].filter(([t]) => !defined.has(t));
    const ratchet = JSON.parse(readFileSync(join(import.meta.dirname, "../css-ratchet.json"), "utf8"));
    const total = unknown.reduce((n, [, c]) => n + c, 0);
    if (total > ratchet.unknownVarTokens) {
      expect.fail(`unbekannte Tokens: ${unknown.map(([t, c]) => `${t}×${c}`).join(", ")} — auf Semantik mappen (BUG-0187), dann Ratchet senken.`);
    }
  });
});
