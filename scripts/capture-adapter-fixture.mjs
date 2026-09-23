#!/usr/bin/env node
/**
 * T1.4: Fixture-System — record a real CLI's JSON event stream, anonymize
 * it, and write it out as adapter normalizer test input.
 *
 *   node scripts/capture-adapter-fixture.mjs --out <path> -- <command> [args...]
 *
 * Example (see packages/adapters/claude/test/fixtures/ for the results of
 * exactly this invocation style):
 *
 *   node scripts/capture-adapter-fixture.mjs \
 *     --out packages/adapters/claude/test/fixtures/new-case.jsonl \
 *     -- claude -p "Reply with exactly: ok" --output-format stream-json --verbose
 *
 * Per AGENTS.md ("Fixtures für echte CLI-Streams (P1): aufgezeichnet,
 * anonymisiert, secret-gescannt — nie Roh-Logs committen"), this script:
 *
 *   1. Runs the command, captures raw stdout.
 *   2. Anonymizes: replaces the real home directory and per-run
 *      socket/temp paths with stable, non-identifying placeholders.
 *   3. Scans the ANONYMIZED result for secret-shaped strings (same
 *      pattern family as pr-review's Gate E) and REFUSES to write the
 *      file if anything matches — a human looks at it then, this script
 *      doesn't decide it's fine on its own.
 *   4. Writes the result to --out.
 *
 * This does not replace judgment: read the fixture before committing it.
 * A clean scan means "nothing matched a known secret shape," not "nothing
 * sensitive is in here."
 */
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";

function parseArgs(argv) {
  const outIdx = argv.indexOf("--out");
  if (outIdx === -1 || argv[outIdx + 1] === undefined) {
    throw new Error("missing --out <path>");
  }
  const dashIdx = argv.indexOf("--");
  if (dashIdx === -1 || dashIdx === argv.length - 1) {
    throw new Error("missing `-- <command> [args...]`");
  }
  return {
    outPath: argv[outIdx + 1],
    command: argv[dashIdx + 1],
    commandArgs: argv.slice(dashIdx + 2),
  };
}

function anonymize(text) {
  let out = text;
  const home = homedir();
  if (home && home.length > 1) {
    out = out.split(home).join("/home/dev");
  }
  // Per-run unix sockets under /run/user/<uid>/... carry a random name —
  // stable placeholder so re-captures don't churn unrelated diff lines.
  out = out.replace(/\/run\/user\/\d+\/[^"'\s]*\.sock/g, "/run/user/1000/redacted.sock");
  return out;
}

const SECRET_PATTERNS = [
  /(api[_-]?key|secret|password|passwd)["'\s]*[:=]["'\s]*[^"'\s]{6,}/gi,
  /sk-[A-Za-z0-9]{16,}/g,
  /\bBearer\s+[A-Za-z0-9._-]{16,}/g,
];

function scanForSecrets(text) {
  const hits = [];
  for (const re of SECRET_PATTERNS) {
    const matches = text.match(re);
    if (matches) hits.push(...matches.slice(0, 5).map((m) => m.slice(0, 60)));
  }
  return hits;
}

async function main() {
  const { outPath, command, commandArgs } = parseArgs(process.argv.slice(2));

  console.log(`capturing: ${command} ${commandArgs.join(" ")}`);
  const proc = spawn(command, commandArgs, { stdio: ["ignore", "pipe", "inherit"] });
  let raw = "";
  proc.stdout.on("data", (d) => (raw += d.toString("utf8")));
  const { code } = await new Promise((resolve) => proc.on("close", (code) => resolve({ code })));
  if (code !== 0) {
    console.warn(`warning: command exited with code ${code} — capturing anyway, inspect before use`);
  }
  if (raw.trim().length === 0) {
    console.error("no stdout captured — nothing to write");
    process.exitCode = 1;
    return;
  }

  const anonymized = anonymize(raw);
  const secretHits = scanForSecrets(anonymized);
  if (secretHits.length > 0) {
    console.error(`\nREFUSING to write ${outPath} — possible secrets found in the capture:`);
    for (const hit of secretHits) console.error(`  ${hit}`);
    console.error("\nInspect the raw output by hand, redact what's needed, then save manually.");
    process.exitCode = 1;
    return;
  }

  await writeFile(outPath, anonymized, "utf8");
  const lineCount = anonymized.split("\n").filter((l) => l.trim()).length;
  console.log(`wrote ${outPath} (${lineCount} lines)`);
  console.log("Read it before committing — a clean secret-scan is not the same as \"nothing sensitive.\"");
}

main().catch((err) => {
  console.error("capture-adapter-fixture:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
