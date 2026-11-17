import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * EPIC-P63 T63.0/AC-P63-4 — Ratchet über rohe UI-Klassen: Flächen, die der
 * Bausteinsatz aus `shared/ui/` (Button, Chip, Card, EmptyState, Sheet)
 * abdeckt, dürfen in `features/` nicht mehr als freie Klassennamen
 * (`class="btn"` …) vorkommen. Zähler sinken mit der Migration (T63.8/T63.9)
 * und enden bei 0. Zusätzlich zählt er Inline-Style-Objekte (AC: statische
 * Styles gehören ins CSS, Laufzeitwerte bekommen Custom Properties).
 */

const PWA = resolve(import.meta.dirname, "..");
const FEATURES = join(PWA, "src/features");
const SRC = join(PWA, "src");

const RAW = ["btn", "chip", "card", "empty", "empty-state", "overlay-sheet"] as const;
type RawKey = `${typeof RAW[number]}`;

type Counts = { rawUiClasses: Record<RawKey, number>; inlineStyleObjects: number };

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tsxFiles(join(dir, e.name)) : /\.tsx$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

function counts(): Counts {
  const rawUiClasses = Object.fromEntries(RAW.map((r) => [r, 0])) as Record<RawKey, number>;
  for (const f of tsxFiles(FEATURES)) {
    const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const m of src.matchAll(/"([^"]*)"/g)) {
      for (const token of m[1]!.trim().split(/\s+/)) if ((RAW as readonly string[]).includes(token)) rawUiClasses[token as RawKey] += 1;
    }
  }
  const inlineStyleObjects = tsxFiles(SRC).reduce(
    (n, f) => n + (readFileSync(f, "utf8").match(/style=\{\{/g) ?? []).length,
    0,
  );
  return { rawUiClasses, inlineStyleObjects };
}

const RATCHET_PATH = join(import.meta.dirname, "css-ratchet.json");
const raw = JSON.parse(readFileSync(RATCHET_PATH, "utf8"));
const ratchet: Counts = { rawUiClasses: raw.rawUiClasses, inlineStyleObjects: raw.inlineStyleObjects };

describe("EPIC-P63 ui-primitives-Ratchet (AC-P63-4)", () => {
  it.each(RAW)("rohe Klasse %s bleibt unterhalb des Ratchet-Werts", (name) => {
    const c = counts();
    if (c.rawUiClasses[name] > ratchet.rawUiClasses[name]) {
      expect.fail(`rohe Klasse ${name}: ${c.rawUiClasses[name]} > Ratchet ${ratchet.rawUiClasses[name]} — Baustein aus shared/ui/ verwenden.`);
    }
  });

  it("Inline-Style-Objekte bleiben unterhalb des Ratchet-Werts", () => {
    const c = counts();
    if (c.inlineStyleObjects > ratchet.inlineStyleObjects) {
      expect.fail(`style={{…}}: ${c.inlineStyleObjects} > Ratchet ${ratchet.inlineStyleObjects} — statische Werte gehören ins CSS.`);
    }
  });
});
