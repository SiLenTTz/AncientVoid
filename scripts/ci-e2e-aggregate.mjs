#!/usr/bin/env node
/**
 * Aggregation der E2E-Shard-Berichte (Laufzeit 2026-11-22): Der e2e-Job läuft
 * als 4-Shard-Matrix; dieser Aggregations-Job wertet die heruntergeladenen
 * JUnit-Dateien je Shard nach den Regeln von ci-e2e-report.mjs
 * (EPIC-P28 T28.4) aus — fehlender Shard-Bericht, null Tests oder Failures
 * machen rot. Er hält den Required-Check-Namen `e2e` stabil, damit die
 * Branch-Protection unverändert bleibt.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { hostname } from "node:os";
import { buildReport, parseJUnit } from "./ci-e2e-report.mjs";

export function decide({ dir, expectedShards, reportPath = null }) {
  const files = [];
  (function walk(d) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "e2e-junit.xml") files.push(p);
    }
  })(dir);
  const perFile = files.map((f) => ({ file: f, ...parseJUnit(readFileSync(f, "utf8")) }));
  const missing = Math.max(0, expectedShards - files.length);
  const tests = perFile.reduce((a, f) => a + f.tests, 0);
  const failures = perFile.reduce((a, f) => a + f.failures + f.errors, 0);
  const errors = 0;
  const skipped = perFile.flatMap((f) => f.skipped);
  const ok = missing === 0 && tests > 0 && failures === 0;
  if (reportPath) {
    const meta = {
      sha: (process.env.GITHUB_SHA ?? "lokal").slice(0, 12),
      runner: `${process.env.GITHUB_RUN_ID ?? "lokal"} (${process.env.GITHUB_RUN_ATTEMPT ? ` Versuch ${process.env.GITHUB_RUN_ATTEMPT} ·` : ""} ${hostname()})`,
      pipeline: process.env.GITHUB_RUN_ID ?? "lokal",
      image: `Aggregation über ${files.length} Shard-Berichte (erwartet ${expectedShards})`,
      node: process.version,
      playwright: JSON.parse(readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8")).devDependencies?.["@playwright/test"] ?? "?",
    };
    const rows = perFile.map((f) => `- ${f.file.replace(`${dir}/`, "")}: ${f.tests} Tests, ${f.failures + f.errors} Failures`).join("\n");
    const base = buildReport({ tests, failures, errors, skipped }, meta);
    const text = `${base}\n## Shards\n\n${rows}${missing ? `\n- fehlende Shard-Berichte: ${missing}` : ""}\n`;
    mkdirSync(join(reportPath, ".."), { recursive: true });
    writeFileSync(reportPath, text);
    process.stdout.write(text);
  }
  return { ok, tests, failures: failures + errors, errors, skipped, missing, files: files.length };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2] ?? "shards";
  const expected = Number(process.env.EXPECTED_SHARDS ?? 4);
  const d = decide({ dir, expectedShards: expected, reportPath: "ci-artifacts/e2e-report.md" });
  process.stdout.write(`E2E-Aggregation: ${d.files}/${expected} Shard-Berichte, ${d.tests} Tests, ${d.failures} Failures, ${d.skipped.length} Skips → ${d.ok ? "GRÜN" : "ROT"}\n`);
  process.exitCode = d.ok ? 0 : 1;
}
