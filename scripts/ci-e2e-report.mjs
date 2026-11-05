#!/usr/bin/env node
/**
 * E2E-Skip-/Fehlerbericht für die CI (EPIC-P28 T28.4): liest die Playwright-
 * JUnit-Datei und schreibt ci-artifacts/e2e-report.md mit SHA, Runner,
 * Zählern und benannten Skips. Skips sind keine Pässe — fehlende JUnit-Datei,
 * null Tests oder Failures machen den Bericht rot, damit „versehentlich
 * fehlende Tests“ (z. B. Browser nicht installiert) nie grün aussehen.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = resolve(import.meta.dirname, "..");

export function parseJUnit(xml) {
  // Playwright schreibt je <testsuite> pro Spec-Datei — über alle summieren,
  // nicht nur die erste lesen (Lauf 3034262577 zeigte sonst „3 Tests“).
  const suites = [...xml.matchAll(/<testsuite\b[^>]*>/g)].map((m) => m[0]);
  const sum = (name) =>
    suites.reduce((acc, suite) => acc + (Number(suite.match(new RegExp(`\\b${name}="(-?\\d+)"`))?.[1] ?? 0)), 0);
  // An <testcase> splitten: jedes Segment trägt seine Attribute bis zum
  // ersten ">" und danach den Rumpf — selbstschließende Tags bleiben eigenständig.
  const segments = xml.split(/<testcase\b/).slice(1);
  const skipped = [];
  for (const seg of segments) {
    const gt = seg.indexOf(">");
    const attrs = seg.slice(0, gt);
    const body = seg.slice(gt + 1);
    if (/<skipped\b/.test(body)) {
      const name = attrs.match(/\bname="([^"]*)"/)?.[1] ?? "?";
      const cls = attrs.match(/\bclassname="([^"]*)"/)?.[1] ?? "";
      skipped.push(`${cls} › ${name}`.trim());
    }
  }
  // Selbst zählen, falls der Reporter Summary-Attribute nicht setzt.
  return {
    tests: sum("tests") || segments.length,
    failures: Math.max(sum("failures"), [...xml.matchAll(/<failure\b/g)].length),
    errors: Math.max(sum("errors"), [...xml.matchAll(/<error\b/g)].length),
    skipped,
  };
}

export function buildReport(data, meta) {
  const lines = [
    "# E2E-Bericht (CI)",
    "",
    `- Commit: \`${meta.sha}\``,
    `- Runner: ${meta.runner}`,
    `- Pipeline/Job: ${meta.pipeline}`,
    `- Image: ${meta.image}, Node: ${meta.node}, Playwright: ${meta.playwright}`,
    `- Laufzeit-Artefakte: \`playwright-report/\`, \`test-results/\` (14 Tage)`,
    "",
    `**${data.tests} Tests · ${data.failures} Failures · ${data.errors} Errors · ${data.skipped.length} Skips**`,
    "",
  ];
  if (data.skipped.length > 0) {
    lines.push("## Skips (keine Pässe)", "");
    for (const s of data.skipped) lines.push(`- ${s}`);
    lines.push("");
  }
  lines.push(data.failures + data.errors === 0 && data.tests > 0 ? "**Grün** — alle gelaufenen Tests bestanden." : "**Rot** — siehe Failures/Errors oben.");
  return lines.join("\n") + "\n";
}

export function main(paths = {}) {
  const junitPath = paths.junitPath ?? join(repoRoot, "test-results", "e2e-junit.xml");
  const reportPath = paths.reportPath ?? join(repoRoot, "ci-artifacts", "e2e-report.md");
  let xml;
  try {
    xml = readFileSync(junitPath, "utf-8");
  } catch {
    console.error(`FAIL: ${junitPath} fehlt — der E2E-Lauf hat keinen Bericht erzeugt (Browser/Tests fehlten?).`);
    process.exitCode = 1;
    return;
  }
  const data = parseJUnit(xml);
  if (data.tests === 0) {
    console.error("FAIL: JUnit enthält 0 Tests — E2E lief nicht vollständig.");
    process.exitCode = 1;
    return;
  }
  const sha = process.env.CI_COMMIT_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).trim();
  const meta = {
    sha,
    runner: process.env.CI_RUNNER_DESCRIPTION ? `${process.env.CI_RUNNER_DESCRIPTION} (ID ${process.env.CI_RUNNER_ID})` : "lokal",
    pipeline: process.env.CI_JOB_URL ? `[${process.env.CI_PIPELINE_ID}](${process.env.CI_JOB_URL})` : "lokaler Lauf",
    image: process.env.CI_JOB_IMAGE ?? "lokal",
    node: process.version,
    playwright: JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8")).devDependencies["playwright"] ?? "?",
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, buildReport(data, meta));
  console.log(`E2E-Bericht: ${data.tests} Tests, ${data.skipped.length} Skips → ${reportPath}`);
  if (data.failures > 0 || data.errors > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
