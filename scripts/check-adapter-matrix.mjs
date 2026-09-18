#!/usr/bin/env node
/**
 * T3.11 (EPIC-P3): "Ehrlichkeitsklausel automatisieren" (aSPARK-Lektion) —
 * verifies README.md's Adapter-Status-Matrix against each adapter's REAL
 * `capabilities()` return, for every adapter that has its own package (a
 * pure, side-effect-free call — no CLI/network access needed to construct
 * the object and read its capabilities).
 *
 * Deliberately a checker, not a silent auto-rewriter: `capabilities()`
 * covers Reasoning/Tools/Cost/Steer/Kontingent, but the Status ("proven"/
 * "unproven"/"geplant") and Phase columns are editorial judgments backed
 * by real test/messlauf evidence (this repo's own "Status wird erst nach
 * bestandenen Contract-Tests auf 'proven' gesetzt" clause) — a script
 * can't responsibly assert those without re-running and cross-referencing
 * the whole evidence trail, so it leaves them to a human and only catches
 * the mechanical drift: a README claiming a capability the real code no
 * longer has (or now has but the README doesn't credit).
 *
 * Adapters reached through the shared openai-compat example (local-llm,
 * deepseek) share one factory whose capabilities don't vary per config,
 * and `swarm`/`copilot`/`cursor-clip`/`zai` have no package to import at
 * all — all skipped, named explicitly in the output, not silently ignored.
 *
 *   npm run check:adapter-matrix
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

const CHECKED = [
  { id: "dummy", modulePath: "../packages/adapter-dummy/src/index.ts" },
  { id: "claude", modulePath: "../packages/adapter-claude/src/index.ts" },
  { id: "codex", modulePath: "../packages/adapter-codex/src/index.ts" },
  { id: "opencode", modulePath: "../packages/adapter-opencode/src/index.ts" },
  { id: "aider", modulePath: "../packages/adapter-aider/src/index.ts" },
];
const SKIPPED = ["copilot", "swarm", "zai", "local-llm", "deepseek", "cursor-clip"];

const SYMBOL_TO_BOOL = { "✓": true, "—": false };

function parseMatrixRow(line) {
  const cells = line
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim());
  if (cells.length < 7) return null;
  const id = cells[0].replace(/[`~*]/g, "").trim();
  return {
    id,
    reasoning: cells[2],
    tools: cells[3],
    cost: cells[4],
    steer: cells[5],
    usage: cells[6],
  };
}

const readme = await readFile(join(repoRoot, "README.md"), "utf8");
const lines = readme.split("\n");
const rows = new Map();
for (const line of lines) {
  if (!line.startsWith("|") || line.startsWith("|---")) continue;
  const row = parseMatrixRow(line);
  if (row) rows.set(row.id, row);
}

let mismatches = 0;
for (const { id, modulePath } of CHECKED) {
  const row = rows.get(id);
  if (!row) {
    console.error(`FAIL: no README matrix row found for adapter "${id}"`);
    mismatches++;
    continue;
  }
  const { createAdapter } = await import(modulePath);
  const caps = createAdapter().capabilities();
  const checks = [
    ["reasoning", caps.reasoning, row.reasoning],
    ["tools", caps.tools, row.tools],
    ["cost", caps.cost, row.cost],
    ["steer", caps.steer, row.steer],
    ["usage", caps.usage, row.usage],
  ];
  for (const [field, real, symbol] of checks) {
    if (!(symbol in SYMBOL_TO_BOOL)) continue; // "~" or "?" — an honest partial/unknown, not a mismatch to flag
    const claimed = SYMBOL_TO_BOOL[symbol];
    if (claimed !== real) {
      console.error(
        `FAIL: ${id}.capabilities().${field} = ${real}, but README matrix says "${symbol}" (claims ${claimed})`,
      );
      mismatches++;
    }
  }
}

console.log(`checked ${CHECKED.length} adapters with real capabilities() calls against README.md`);
console.log(`skipped (no dedicated package / shared factory): ${SKIPPED.join(", ")}`);

if (mismatches > 0) {
  console.error(`\nFAIL: ${mismatches} README-vs-capabilities() mismatch(es) — update README.md's matrix.`);
  process.exit(1);
}
console.log("\nPASS: README Adapter-Status-Matrix matches every checked adapter's real capabilities().");
