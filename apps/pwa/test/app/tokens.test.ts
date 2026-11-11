import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CALL_COLOR, contrastRatio, DEFAULT_ACCENT } from "../../src/app/appearance.ts";

/**
 * EPIC-P43 T43.1 (AC-P43-4): die Farb-Tokens beider Erscheinungsbilder, direkt aus dem Stylesheet
 * gelesen. Text braucht 4,5:1 auf Hintergrund und Kartenfläche.
 */
const css = readFileSync(resolve(import.meta.dirname, "../../src/app/styles/01-base.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} fehlt`).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf("\n}", start));
  return Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1]!, m[2]!.toLowerCase()]));
}

const THEMES = { dunkel: block(":root"), hell: block('[data-theme="light"]') };
/** Farben, die als Text auf --bg und --bg-elev stehen. */
const TEXT = ["--fg", "--fg-dim", "--fg-faint", "--accent", "--call", "--info", "--err"];
/** Fläche und ihre Schriftfarbe. */
const INK: [string, string][] = [["--accent", "--accent-ink"], ["--call", "--call-ink"], ["--info", "--info-ink"]];

describe.each(Object.entries(THEMES))("Farb-Tokens, %s", (name, t) => {
  it.each(TEXT)("%s erreicht als Text 4,5:1 auf Hintergrund und Karte", (token) => {
    expect(t[token], `${token} fehlt`).toBeTruthy();
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
});

describe("bekannte Ausnahme: --ok und --warn im hellen Erscheinungsbild", () => {
  // EPIC-P43 §2 lässt die semantischen Farben --ok/--err unverändert. Als Text liegen --ok (4,2:1) und
  // --warn (4,7:1 auf Karte, 4,2:1 auf Hintergrund) hell unter bzw. an der Grenze; sie tragen Zustand
  // deshalb nie allein über Text, sondern mit Form (StatusDot, T43.2). Der Test hält den Stand fest.
  it("hält den dokumentierten Stand", () => {
    const t = THEMES.hell;
    expect(contrastRatio(t["--ok"]!, t["--bg-elev"]!)).toBeGreaterThanOrEqual(4.2);
    expect(contrastRatio(t["--ok"]!, t["--bg-elev"]!)).toBeLessThan(4.5);
    expect(contrastRatio(t["--warn"]!, t["--bg-elev"]!)).toBeGreaterThanOrEqual(4.5);
  });
});
