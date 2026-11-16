#!/usr/bin/env node
/**
 * Generiert scripts/slow-tests.json aus einem Vitest-JUnit-Bericht: alle
 * Test-Dateien über dem Schwellenwert (Sekunden, Dateisumme) gehören zur
 * vollen Messlatte (nightly.yml) und laufen im PR-Gate nur im schnellen Kern
 * (docs/ci-runbook.md). Laufzeit des vollen Laufs auf GitHub-Runnern messen,
 * nicht lokal — Runner-Timing ist maßgeblich. Nur existierende Dateien
 * landen in der Liste.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function collect(junitXml, root, thresholdSeconds) {
  const perFile = new Map();
  for (const suite of junitXml.matchAll(/<testsuite\b([^>]*)>([\s\S]*?)<\/testsuite>/g)) {
    const attrs = Object.fromEntries([...suite[1].matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
    const name = attrs.name ?? attrs.file ?? attrs.filepath ?? attrs.package;
    if (!name) continue;
    let seconds = 0;
    for (const tc of suite[2].matchAll(/<testcase\b[^>]*time="([\d.]+)"[^>]*>/g)) seconds += Number(tc[1]);
    if (seconds === 0) seconds = Number(attrs.time ?? 0);
    if (seconds > Number(thresholdSeconds)) perFile.set(name, seconds);
  }
  return [...perFile]
    .filter(([name]) => existsSync(join(root, name)))
    .map(([file, seconds]) => ({ file, seconds: Math.round(seconds * 10) / 10 }))
    .sort((a, b) => b.seconds - a.seconds);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [junitPath, threshold = "10"] = process.argv.slice(2);
  if (!junitPath) {
    process.stderr.write("Usage: node scripts/gen-slow-tests.mjs <vitest-junit.xml> [thresholdSeconds]\n");
    process.exitCode = 1;
  } else {
    const root = join(import.meta.dirname, "..");
    const files = collect(readFileSync(junitPath, "utf8"), root, threshold);
    const json = `${JSON.stringify({ thresholdSeconds: Number(threshold), generated: new Date().toISOString().slice(0, 10), source: "vitest-JUnit eines vollen Laufs (node scripts/gen-slow-tests.mjs <junit.xml>)", files }, null, 2)}\n`;
    writeFileSync(join(root, "scripts/slow-tests.json"), json);
    process.stdout.write(`scripts/slow-tests.json: ${files.length} Dateien über ${threshold}s\n`);
  }
}
