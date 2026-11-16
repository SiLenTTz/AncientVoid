#!/usr/bin/env node
// EPIC-P26 T26.9 / AC-P26-8: der frühere Name „harnez“ taucht in Code, Meldungen und aktueller Doku
// nicht mehr auf. Erlaubt ist nur, was ihn als Datum braucht: der dokumentierte `.harnez/`-Lesefallback,
// Fabrik-Kopien `harnez-exec-*`, Projektnamen in Testdaten, historische Retros/ADRs/Messläufe.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ALLOW_FILES = [
  /^epics\//, // Planung und Retros dokumentieren die Umbenennung
  /^docs\/messlauf\//,
  /^docs\/adr\//,
  /^docs\/loop-analyse-/,
  /^docs\/produktionsreife-report-/,
  /^bugs\//,
  /^scripts\/check-names\.mjs$/,
  /^package-lock\.json$/,
  // Testdaten, die echte Verzeichnis-/Sitzungsnamen der Fabrik nachbilden
  /^packages\/core\/test\/modules\/discovery\//,
  /^apps\/pwa\/test\/features\/discovery\//,
  /^e2e\/specs\/discovery\.spec\.ts$/,
  /^packages\/loops\/securesight-factory\/test\//, // prüfen den .harnez/-Lesefallback
];
// Zeilen, die den Fallback bzw. die Fabrik-Kopien benennen
const ALLOW_LINES = [/\.harnez\b/, /harnez-exec/, /früher `\.harnez/, /noch \.harnez\//];

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const hits = [];
for (const f of files) {
  if (ALLOW_FILES.some((r) => r.test(f))) continue;
  let text;
  try {
    text = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  if (text.includes("\0")) continue;
  text.split("\n").forEach((line, i) => {
    if (/harnez/i.test(line) && !ALLOW_LINES.some((r) => r.test(line))) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 140)}`);
  });
}
if (hits.length > 0) {
  console.error(`check:names — „harnez“ außerhalb der Allowlist (AC-P26-8):\n${hits.join("\n")}`);
  process.exit(1);
}
console.log("check:names: kein „harnez“ außerhalb der dokumentierten Ausnahmen");
