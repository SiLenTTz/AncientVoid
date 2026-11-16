#!/usr/bin/env node
// Epic-Status: hebt EPIC-P*.md-Dateien mit offenen Punkten im Datenbaum farblich
// hervor. Die Epic-Inhalte werden nie verändert — nur gelesen und angezeigt.
// Erkennungsregeln und ihre Begründung: docs/epic-status.md
import { readdirSync, readFileSync } from "node:fs";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

// Statuszeile der Epic-Datei (kuratiertes Feld, Zeile 3 in allen EPIC-P*.md).
const STATUS_LINE = /^\*\*Status:\*\*\s*(.+)$/;
// Nur das erste Segment (bis „ · “) ist der Statustext; alles danach sind
// Phase/Dauer/Abhängigkeit — Negationen wie „fachlich keine offene“ stehen
// dort und dürfen nicht falsch-zählen.
const STATUS_SEGMENT_SEP = " · ";

// S1 — Offen-Vokabular im Statustext (Wortformen bewusst eng: „offene“/
// „offenbar“ als Komposita/Adverb treffen bewusst nicht zu).
const OPEN_STATUS_CONTAINS = [
  { re: /\boffen\b/, label: "offen" },
  { re: /\bteilweise\b/, label: "teilweise" },
  { re: /\bbis auf\b/, label: "bis auf" },
];
// S2 — Abschluss-Vokabular: Nur ein Statustext, der so beginnt, kann ein Epic
// schließen („Umsetzung“ als Substantiv ≠ „umgesetzt“ als Partizip).
const CLOSED_STATUS_PREFIXES = ["abgeschlossen", "code abgeschlossen", "umgesetzt", "exit grün", "grün", "fertiggestellt"];
// C1 — offene Markdown-Checkbox; ein Delegationsvermerk nimmt die Zeile aus
// (der Punkt lebt dann sichtbar in einem anderen Epic weiter).
const OPEN_CHECKBOX = /^\s*[-*] \[ \]/;
const DONE_CHECKBOX = /^\s*[-*] \[[xX]\]/;
const DELEGATED_LINE = /(verschoben nach|nach P\d+(\.\d+)?\b)/;
// C2 — expliziter TODO-Marker mit Doppelpunkt; Prosa wie „kein TODO ohne
// Epic-Bezug“ (Definition of Done) trifft bewusst nicht zu.
const TODO_MARKER = /\bTODO:/;

const EPIC_FILE = /^EPIC-P[\d.]+-.+\.md$/;

export function classifyEpicText(text) {
  const lines = text.split("\n");
  const statusLine = lines.find((l) => STATUS_LINE.test(l));
  const segment = statusLine ? statusLine.match(STATUS_LINE)[1].split(STATUS_SEGMENT_SEP)[0].trim() : null;

  const counts = { openCheckboxes: 0, delegatedCheckboxes: 0, doneCheckboxes: 0, todo: 0 };
  for (const line of lines) {
    if (OPEN_CHECKBOX.test(line)) {
      if (DELEGATED_LINE.test(line)) counts.delegatedCheckboxes += 1;
      else counts.openCheckboxes += 1;
    } else if (DONE_CHECKBOX.test(line)) counts.doneCheckboxes += 1;
    if (TODO_MARKER.test(line)) counts.todo += 1;
  }

  const reasons = [];
  if (segment !== null) {
    const hit = OPEN_STATUS_CONTAINS.find((o) => o.re.test(segment));
    if (hit) reasons.push({ rule: "S1", label: `Statustext nennt „${hit.label}“` });
    else if (!CLOSED_STATUS_PREFIXES.some((p) => segment.toLowerCase().startsWith(p)))
      reasons.push({ rule: "S2", label: `Statustext beginnt nicht mit Abschluss-Vokabular („${segment.slice(0, 60)}“)` });
  }
  if (counts.openCheckboxes > 0) reasons.push({ rule: "C1", label: `${counts.openCheckboxes} offene Checkbox(en)` });
  if (counts.todo > 0) reasons.push({ rule: "C2", label: "TODO-Marker" });

  return { open: reasons.length > 0, reasons, counts };
}

export function scanEpicsDir(epicsDir) {
  const names = readdirSync(epicsDir).filter((n) => n.endsWith(".md"));
  names.sort((a, b) => a.localeCompare(b, "de", { numeric: true }));
  return names.map((name) => {
    if (!EPIC_FILE.test(name)) return { file: name, epic: false };
    const { open, reasons, counts } = classifyEpicText(readFileSync(join(epicsDir, name), "utf8"));
    const phase = name.match(/^EPIC-P([\d.]+)-/)[1];
    return { file: name, epic: true, phase: `P${phase}`, open, reasons, counts };
  });
}

// ——— Ausgabe ———

const RESET = "\x1b[0m";
const BOLD_YELLOW = "\x1b[1;33m";
const DIM = "\x1b[2m";

export function renderTree(entries, color) {
  const c = (code, s) => (color ? `${code}${s}${RESET}` : s);
  const epics = entries.filter((e) => e.epic);
  const open = epics.filter((e) => e.open);
  const closed = epics.length - open.length;
  const width = Math.max(...entries.map((e) => e.file.length));

  const out = [`epics/ ${c(DIM, `— ${epics.length} Epic-Dateien: ${open.length} offen, ${closed} abgeschlossen (nur EPIC-P*.md werden gewertet)`)}`];
  entries.forEach((e, i) => {
    const branch = i === entries.length - 1 ? "└──" : "├──";
    const pad = " ".repeat(Math.max(1, width - e.file.length + 2));
    let status = "";
    if (e.epic && e.open) status = c(BOLD_YELLOW, `offen: ${e.reasons.map((r) => r.label).join(" · ")}`);
    else if (e.epic) status = c(DIM, `abgeschlossen (${e.counts.doneCheckboxes} ✓${e.counts.delegatedCheckboxes > 0 ? `, ${e.counts.delegatedCheckboxes} delegiert` : ""})`);
    out.push(`${branch} ${e.epic && e.open ? c(BOLD_YELLOW, e.file) : e.file}${pad}${status}`.trimEnd());
  });

  out.push("");
  out.push(c(BOLD_YELLOW, "Legende"));
  out.push(`  ${c(BOLD_YELLOW, "gelb, fett")} = Epic mit offenen Punkten · normale Farbe = ohne offene Punkte (unverändert)`);
  out.push("  Offen-Regeln (Details und Beispiele: docs/epic-status.md):");
  out.push(`    ${c(BOLD_YELLOW, "S1")} Statustext (Zeile „**Status:** …“, Segment bis „ · “) nennt „offen“, „teilweise“ oder „bis auf“`);
  out.push(`    ${c(BOLD_YELLOW, "S2")} Statustext beginnt nicht mit Abschluss-Vokabular (${CLOSED_STATUS_PREFIXES.join(", ")}) — konservativ: nur ausdrücklicher Abschluss schließt`);
  out.push(`    ${c(BOLD_YELLOW, "C1")} offene Checkbox „- [ ]“ ohne Delegationsvermerk („verschoben nach …“ / „nach P<n>“) in der Zeile`);
  out.push(`    ${c(BOLD_YELLOW, "C2")} expliziter „TODO:“-Marker`);
  return out.join("\n");
}

export function renderJson(entries) {
  const epics = entries.filter((e) => e.epic);
  return JSON.stringify(
    {
      summary: { total: epics.length, open: epics.filter((e) => e.open).length, closed: epics.filter((e) => !e.open).length },
      rules: { S1: "Statustext nennt offen/teilweise/bis auf", S2: "Statustext ohne Abschluss-Vokabular", C1: "offene Checkbox ohne Delegation", C2: "TODO:-Marker" },
      files: epics.map(({ file, phase, open, reasons, counts }) => ({ file, phase, open, reasons, counts })),
    },
    null,
    2,
  );
}

function main() {
  const args = process.argv.slice(2);
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const epicsDir = args.includes("--epics") ? args[args.indexOf("--epics") + 1] : join(repoRoot, "epics");
  const color = !args.includes("--plain") && !process.env.NO_COLOR && (process.stdout.isTTY || args.includes("--color"));

  const entries = scanEpicsDir(epicsDir);
  console.log(args.includes("--json") ? renderJson(entries) : renderTree(entries, color));
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
