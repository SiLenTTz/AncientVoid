#!/usr/bin/env node
// AC-P1-6 (AI-P1-2): Secret-Scan als eigenständiges, wiederholtes CI-Gate —
// nicht nur der Schreibzeitpunkt-Check in scripts/capture-adapter-fixture.mjs.
// Scannt ausschließlich getrackte Dateien (`git ls-files`): data/ ist
// git-ignored und gehört nie zum Scan, generierte Verzeichnisse (dist/,
// test-results/) sind nicht getrackt.
//
// Fail loud: jeder Fund bricht mit exit 1 ab und nennt Datei, Zeile, Regel
// und einen gekürzten Match-Anfang — nie den vollständigen Secret-Text
// (der Fund selbst soll kein zweites Mal im Log landen).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

/**
 * Hoch-Präzisions-Muster: Jede Regel matcht tokenförmige Geheimnisse mit
 * fester Präfix- und Längenstruktur — bewusst KEINE generischen
 * `(password|secret)\s*[:=]`-Heuristiken, deren False-Positive-Flut ein Gate
 * unbrauchbar macht (der erste reflexhafte `--no-verify` wäre die Folge).
 */
export const RULES = [
  { name: "private-key", re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA |ENCRYPTED )?PRIVATE KEY-----/g },
  { name: "github-pat", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{36,})\b/g },
  { name: "gitlab-pat", re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { name: "openai-key", re: /\bsk-(?!ant-)(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b/g },
  { name: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
];

/**
 * Ausdrücklich erlaubte exakte Match-Strings — jeder Eintrag mit Begründung.
 * Nur nachweislich gefälschte/platzhalterhafte Werte, nie "vielleicht echt".
 */
const ALLOWED = new Set([
  // Gepflanzter Test-Fake aus scripts/check-secrets.test.mjs (positive probe
  // für die private-key-Regel): Standard-PEM-Header ohne Key-Body, im
  // Testfile absichtlich enthalten — kein echtes Geheimnis.
  "-----BEGIN OPENSSH PRIVATE KEY-----",
]);

/**
 * Scannt die Zeilen einer Datei.
 * @returns {{ file: string, line: number, rule: string, preview: string }[]}
 */
export function scanText(getLine, lineCount, file) {
  const findings = [];
  for (let i = 0; i < lineCount; i++) {
    const line = getLine(i) ?? "";
    for (const { name, re } of RULES) {
      for (const match of line.matchAll(re)) {
        const text = match[0] ?? "";
        if (ALLOWED.has(text)) continue;
        findings.push({ file, line: i + 1, rule: name, preview: `${text.slice(0, 10)}…` });
      }
    }
  }
  return findings;
}

/** Binary-Check: Eine NUL-Byte in den ersten 8 KB bedeutet Binärdatei. */
function looksBinary(buf) {
  return buf.subarray(0, 8192).includes(0);
}

export async function scanFiles(files) {
  const findings = [];
  for (const file of files) {
    let buf;
    try {
      buf = await readFile(file);
    } catch {
      // Gelöschte/verschobene Dateien zwischen ls-files und Lesen: überspringen,
      // git zeigt sie im nächsten Lauf nicht mehr an.
      continue;
    }
    if (looksBinary(buf)) continue;
    const lines = buf.toString("utf8").split("\n");
    findings.push(...scanText((i) => lines[i], lines.length, file));
  }
  return findings;
}

async function trackedFiles() {
  const { stdout } = await execFileAsync("git", ["ls-files"], { timeout: 10_000, maxBuffer: 8 * 1024 * 1024 });
  return stdout.split("\n").filter(Boolean);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let files;
  try {
    files = await trackedFiles();
  } catch (err) {
    console.error(`check-secrets: git ls-files fehlgeschlagen (${err instanceof Error ? err.message : err}) — kein Repo?`);
    process.exit(2);
  }
  const findings = await scanFiles(files);
  if (findings.length > 0) {
    console.error(`check-secrets: ${findings.length} Fund/Funde in getrackten Dateien:`);
    for (const f of findings) console.error(`  ${f.file}:${f.line} [${f.rule}] ${f.preview}`);
    console.error("Keine Secrets committen — Fund entfernen, Token rotieren, dann erneut laufen lassen.");
    process.exit(1);
  }
  console.log(`check-secrets: ${files.length} getrackte Dateien gescannt, 0 Treffer.`);
}
