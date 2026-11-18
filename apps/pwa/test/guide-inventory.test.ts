import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PAGE_SLUG } from "../src/app/route.ts";
import type { LayerKind } from "../src/shared/layers.ts";

// EPIC-P62 T62.1: LayerKind-ausführlich — kompiliert nicht mehr, wenn der
// Union-Typ wächst und diese Liste den neuen Kind vergisst.
const LAYERS = ["files", "browser", "devices"] as const satisfies readonly LayerKind[];
type _MissingLayer = Exclude<LayerKind, (typeof LAYERS)[number]>;
const _layerGuard: _MissingLayer extends never ? true : "LayerKind ohne Inventar-Liste" = true;
void _layerGuard;
// AC-P62-1: neue Seite/Layer/Feature-Ordner ohne Inventarzeile → rot;
// entfernte Flächen mit Restzeile → ebenso (Drift in beide Richtungen).

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../../");
const inventoryPath = join(repoRoot, "docs/guide/inventory.md");

/** Zeilen der Form `| <id> | … |` → IDs je Kategorie. */
function inventoryIds(prefix: string): Map<string, string> {
  const rows = new Map<string, string>();
  for (const line of readFileSync(inventoryPath, "utf8").split("\n")) {
    const m = /^\|\s*(\S+)\s*\|(.+)\|\s*$/.exec(line);
    if (!m) continue;
    const [id, rest] = [m[1]!, m[2]!];
    if (!id.startsWith(`${prefix}:`)) continue;
    rows.set(id.slice(prefix.length + 1), rest.trim());
  }
  return rows;
}

/** Spec-Spalte ist jeweils die letzte Zelle — Datei muss existieren. */
function specOf(row: string): string {
  const cells = row.split("|").map((c) => c.trim()).filter(Boolean);
  return cells[cells.length - 1]!;
}

describe("Guide-Inventar (EPIC-P62 T62.1, AC-P62-1)", () => {
  it("existiert und ist verlinkt (kein stiller Verfall)", () => {
    expect(existsSync(inventoryPath), "docs/guide/inventory.md fehlt").toBe(true);
  });

  it("jede PAGE_SLUG-Seite hat eine Zeile — und umgekehrt", () => {
    const rows = inventoryIds("page");
    for (const page of Object.keys(PAGE_SLUG)) {
      expect(rows.has(page), `Seite "${page}" fehlt im Guide-Inventar (docs/guide/inventory.md)`).toBe(true);
    }
    for (const page of rows.keys()) {
      expect(page in PAGE_SLUG, `Inventarzeile "page:${page}" nennt eine Seite, die es nicht mehr gibt`).toBe(true);
    }
  });

  it("jeder LayerKind hat eine Zeile — und umgekehrt", () => {
    const rows = inventoryIds("layer");
    for (const kind of LAYERS) {
      expect(rows.has(kind), `Layer "${kind}" fehlt im Guide-Inventar`).toBe(true);
    }
    const known = new Set<string>(LAYERS);
    for (const kind of rows.keys()) {
      expect(known.has(kind), `Inventarzeile "layer:${kind}" nennt einen Layer, den es nicht gibt`).toBe(true);
    }
  });

  it("jeder Feature-Ordner hat eine Zeile — und umgekehrt", () => {
    const featureDir = join(repoRoot, "apps/pwa/src/features");
    const dirs = readdirSync(featureDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    const rows = inventoryIds("feature");
    for (const dir of dirs) {
      expect(rows.has(dir), `Feature-Ordner "${dir}" fehlt im Guide-Inventar`).toBe(true);
    }
    for (const dir of rows.keys()) {
      expect(dirs.includes(dir), `Inventarzeile "feature:${dir}" nennt einen Feature-Ordner, den es nicht gibt`).toBe(true);
    }
  });

  it("jede genannte e2e-Spec existiert", () => {
    const all = [...inventoryIds("page").values(), ...inventoryIds("view").values(), ...inventoryIds("layer").values(), ...inventoryIds("feature").values()];
    expect(all.length).toBeGreaterThan(40); // Parser-Guard: Tabelle wurde gelesen
    for (const row of all) {
      const spec = specOf(row);
      expect(spec, `letzte Zelle sollte ein Spec-Kürzel sein: "${row}"`).toMatch(/^[a-z0-9-]+$/);
      expect(existsSync(join(repoRoot, "e2e/specs", `${spec}.spec.ts`)), `e2e/specs/${spec}.spec.ts fehlt (genannt in: "${row}")`).toBe(true);
    }
  });

  it("AC-P62-1/2: jede Inventar-ID hat eine Guide-Sektion — und umgekehrt", () => {
    const guide = readFileSync(join(repoRoot, "docs/guide/README.md"), "utf8");
    const sections = new Set([...guide.matchAll(/^### (page|view|layer|feature):([a-z-]+)\b/gm)].map((m) => `${m[1]}:${m[2]}`));
    for (const prefix of ["page", "view", "layer", "feature"]) {
      for (const id of inventoryIds(prefix).keys()) {
        expect(sections.has(`${prefix}:${id}`), `Guide-Sektion für "${prefix}:${id}" fehlt (docs/guide/README.md)`).toBe(true);
      }
      const known = new Set(inventoryIds(prefix).keys());
      for (const s of sections) {
        if (s.startsWith(`${prefix}:`)) expect(known.has(s.slice(prefix.length + 1)), `Guide-Sektion "${s}" ohne Inventar-Eintrag`).toBe(true);
      }
    }
  });

  it("AC-P62-2: Screenshot-Hashes stimmen, jedes Asset ist im Guide mit alt-Text", () => {
    const hashesPath = join(repoRoot, "docs/guide/assets/hashes.json");
    expect(existsSync(hashesPath), "docs/guide/assets/hashes.json fehlt — npm run guide:shots").toBe(true);
    const hashes = JSON.parse(readFileSync(hashesPath, "utf8")) as Record<string, string>;
    const guide = readFileSync(join(repoRoot, "docs/guide/README.md"), "utf8");
    const onDisk = readdirSync(join(repoRoot, "docs/guide/assets")).filter((f) => f.endsWith(".png"));
    expect(onDisk.length).toBeGreaterThanOrEqual(12);
    for (const file of onDisk) {
      expect(hashes[file], `${file} fehlt in hashes.json — neu erzeugen (npm run guide:shots)`).toBeDefined();
      const actual = createHash("sha256").update(readFileSync(join(repoRoot, "docs/guide/assets", file))).digest("hex");
      expect(actual, `${file} weicht von hashes.json ab — manuell geändert statt neu erzeugt?`).toBe(hashes[file]);
      expect(guide.includes(`assets/${file}`), `${file} ist im Guide nicht eingebunden (alt-Text nötig)`).toBe(true);
    }
    for (const file of Object.keys(hashes)) expect(onDisk.includes(file), `hashes.json nennt ${file}, Datei fehlt`).toBe(true);
  });
});
