#!/usr/bin/env node
// Pilot 1 der Skill-Kur (EPIC-P72 T72.4-Muster): die ersten N Zeilen, deterministisch.
// Aufruf: node scripts/head-n.mjs <datei> [-n N] [--json]   (N Standard 10)
// Exit 0 ok / 1 Befund / 2 Fehler.

import { readFileSync } from "node:fs";

export function headN(text, { n = 10 } = {}) {
  if (typeof text !== "string" || !Number.isInteger(n) || n < 1) return { code: 2, lines: [], error: "usage: headN(text, { n >= 1 })" };
  const all = text.split("\n");
  const lines = all.slice(0, n);
  return { code: 0, lines, truncated: Math.max(0, all.length - n) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2).filter((a) => a !== "--json");
  const json = process.argv.includes("--json");
  const ni = args.indexOf("-n");
  const n = ni >= 0 ? Number.parseInt(args.splice(ni, 2)[1], 10) : 10;
  const file = args[0];
  if (!file) { process.stderr.write("head-n: keine Datei angegeben\n"); process.exit(2); }
  const r = headN(readFileSync(file, "utf8"), { n });
  if (r.code !== 0) { process.stderr.write(`head-n: ${r.error}\n`); process.exit(2); }
  if (json) process.stdout.write(JSON.stringify(r) + "\n");
  else { for (const l of r.lines) process.stdout.write(l + "\n"); if (r.truncated) process.stderr.write(`head-n: ${r.truncated} weitere Zeilen\n`); }
  process.exit(0);
}
