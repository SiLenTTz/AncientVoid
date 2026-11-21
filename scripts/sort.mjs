#!/usr/bin/env node
// Pilot 2 der Skill-Kur (EPIC-P72 T72.4-Muster): Zeilen deterministisch sortieren
// (Byteordnung) oder als Histogramm (count desc, Ties in Byteordnung).
// Aufruf: node scripts/sort.mjs [<datei>] [-c] [--json]   (ohne Datei: stdin)
// Exit 0 ok / 1 Befund / 2 Fehler.

import { readFileSync } from "node:fs";

export function sortLines(text, { count = false } = {}) {
  if (typeof text !== "string" || text === "") return { code: 2, lines: [], error: "sort: leerer Input" };
  const all = text.split("\n").filter((l) => l !== "");
  if (!all.length) return { code: 2, lines: [], error: "sort: leerer Input" };
  const bytewise = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  if (!count) return { code: 0, lines: [...all].sort(bytewise) };
  const freq = new Map();
  for (const l of all) freq.set(l, (freq.get(l) ?? 0) + 1);
  const lines = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || bytewise(a[0], b[0]))
    .map(([l, c]) => `${c} ${l}`);
  return { code: 0, lines };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2).filter((a) => a !== "--json");
  const json = process.argv.includes("--json");
  const count = args.includes("-c");
  const file = args.find((a) => !a.startsWith("-"));
  const text = file ? readFileSync(file, "utf8") : readFileSync(0, "utf8");
  const r = sortLines(text, { count });
  if (r.code !== 0) { process.stderr.write(`${r.error}\n`); process.exit(2); }
  if (json) process.stdout.write(JSON.stringify(r) + "\n");
  else for (const l of r.lines) process.stdout.write(l + "\n");
  process.exit(0);
}
