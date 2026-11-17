#!/usr/bin/env node
/**
 * EPIC-P63 T63.10: Token-Tabelle aus apps/pwa/src/app/styles/00-tokens.css
 * für docs/design-system.md. Frischhalte: `npm run docs:design-tokens`
 * bzw. `--check` (von check:context / manuell).
 *
 *   node scripts/design-tokens-doc.mjs           schreibt die Markertabelle
 *   node scripts/design-tokens-doc.mjs --check   Exit 1 bei Drift
 */
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOKENS = join(ROOT, "apps/pwa/src/app/styles/00-tokens.css");
const DOC = join(ROOT, "docs/design-system.md");
const BEGIN = "<!-- BEGIN:design-tokens (scripts/design-tokens-doc.mjs) -->";
const END = "<!-- END:design-tokens -->";

/** @returns {{ name: string, value: string, layer: string }[]} */
export function parseTokens(css) {
  const rows = [];
  let layer = "sonst";
  let inLight = false;
  for (const raw of css.split("\n")) {
    const line = raw.trim();
    // Light-Override und @media-Nachzüge: Dunkel-Default schon erfasst → stoppen.
    if (line.startsWith("[data-theme") || line.startsWith("@media")) {
      inLight = true;
      continue;
    }
    if (inLight) continue;
    if (line.includes("Schicht 1")) layer = "primitiv";
    else if (line.includes("Schicht 2") || line.includes("─── Semantik") || line.includes("Semantik —")) layer = "semantik";
    else if (line.includes("Form ───") || line.startsWith("/* ─── Form")) layer = "form";
    else if (line.includes("Typografie")) layer = "typografie";
    else if (line.includes("Skalen") || line.includes("Abstände")) layer = "skala";
    else if (line.includes("Ziele")) layer = "ziel";
    else if (line.includes("Bewegung")) layer = "bewegung";
    else if (line.includes("Ebenen-Leiter")) layer = "ebene";
    else if (line.includes("JS-/Preset") || line.includes("Preset-Eingänge")) layer = "preset";
    const m = /^--([a-z0-9-]+)\s*:\s*(.+?);/.exec(line);
    if (!m) continue;
    rows.push({ name: `--${m[1]}`, value: m[2].trim(), layer });
  }
  return rows;
}

export function renderTable(rows) {
  const keep = rows;
  const lines = [
    BEGIN,
    "",
    "> Generiert aus `apps/pwa/src/app/styles/00-tokens.css` — nicht von Hand pflegen.",
    "> `npm run docs:design-tokens` bzw. `--check`. Light überschreibt nur Semantik (`[data-theme=\"light\"]`).",
    "",
    "| Token | Schicht | Wert (Dunkel-Default) |",
    "|---|---|---|",
    ...keep.map((r) => `| \`${r.name}\` | ${r.layer} | \`${r.value.replaceAll("|", "\\|")}\` |`),
    "",
    END,
  ];
  return lines.join("\n");
}

export function applyToDoc(doc, table) {
  if (!doc.includes(BEGIN) || !doc.includes(END)) {
    throw new Error("docs/design-system.md: Marker BEGIN/END:design-tokens fehlen");
  }
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Zeilenende des Dokuments respektieren (BUG-0198): ein Windows-Checkout (autocrlf) liegt
  // in CRLF vor, der Vergleich in `--check` ist byte-genau — eine LF-Tabelle in einem
  // CRLF-Dokument wäre für den Check per Definition veraltet und die Korrektur mischte
  // LF-Zeilen ins Dokument. Die Ersetzung als Funktion (nicht als String) hält außerdem
  // `$&`-artige Tokenwerte von der Ersetzungssprache fern.
  const eol = doc.includes("\r\n") ? "\r\n" : "\n";
  const block = table.trimEnd().split("\n").join(eol);
  return doc.replace(new RegExp(`${esc(BEGIN)}[\\s\\S]*?${esc(END)}`), () => block);
}

function main() {
  const check = process.argv.includes("--check");
  const css = readFileSync(TOKENS, "utf8");
  const table = renderTable(parseTokens(css));
  const doc = readFileSync(DOC, "utf8");
  const next = applyToDoc(doc, table);
  if (check) {
    if (next !== doc) {
      console.error("docs/design-system.md Token-Tabelle veraltet — npm run docs:design-tokens");
      process.exit(1);
    }
    return;
  }
  writeFileSync(DOC, next);
  console.log("updated", DOC);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
