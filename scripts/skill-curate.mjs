#!/usr/bin/env node
// EPIC-P72 T72.10: Kurator. Aggregation, Klassifikation, Max-2, --apply mit
// Validierung und Revert. Kein LLM im Pipeline-Pfad (ADR-0100).
// Aufruf: node scripts/skill-curate.mjs [--root <dataDir>] [--runs <file.json>] [--project p]
//         [--since ISO] [--apply] [--diff-file <file.json>] [--state <dir>] [--json]
// Exit 0 ok / 1 Befund / 2 Fehler.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { extractRuns, evaluateRuns, mineSequences } from "./skill-runs.mjs";
import { checkSkills } from "./check-skills.mjs";
import { checkSubject } from "./commit-notation.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "..");

export async function curate(opts) {
  const {
    root = join(REPO_ROOT, "data"), runs: runsArg = null, project = null, since = null,
    apply = false, diffFile = null, stateDir = null, skillRoot = REPO_ROOT,
    catalogPath = join(REPO_ROOT, ".claude", "skills", "_shared", "skill-checks.json"),
    casesDir = join(REPO_ROOT, "scripts", "skill-regression"),
  } = opts;
  const state = stateDir ?? join(root, "data", "skill-curation");
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  const cfg = catalog.$config ?? {};
  const minRuns = opts.minRuns ?? cfg.minRuns ?? 2;
  const maxLessons = cfg.maxLessons ?? 2;

  const runs = Array.isArray(runsArg) ? runsArg : runsArg ? JSON.parse(readFileSync(runsArg, "utf8")) : extractRuns(root, { project, since });
  const cursorPath = join(state, "cursor.json");
  const seen = existsSync(cursorPath) ? JSON.parse(readFileSync(cursorPath, "utf8")).seen ?? [] : [];
  const newRuns = runs.filter((r) => !seen.includes(r.sessionId));

  const lessons = await collectLessons(newRuns, catalog, { minRuns, skillRoot, state, apply });
  const diffs = diffFile ? JSON.parse(readFileSync(diffFile, "utf8")) : [];

  if (!newRuns.length && !diffs.length) return { verdict: "NO_CHANGE", lessons: [], regression_results: null, commit_message: null };

  const result = {
    verdict: "NO_CHANGE",
    lessons: lessons.slice(0, maxLessons).map((l) => ({ id: l.id, classification: l.classification, evidence_task_ids: l.evidence, diffs: l.diffs ?? [] })),
    regression_results: null,
    commit_message: null,
    truncated_lessons: Math.max(0, lessons.length - maxLessons),
  };
  if (!apply || !diffs.length) {
    if (lessons.length || diffs.length) result.verdict = "ACCEPTED"; // ohne --apply: Bewertung, keine Schreibens
    if (!apply) result.dryRun = true;
  }

  if (apply && diffs.length) {
    const applied = [];
    try {
      for (const d of diffs) {
        const target = join(skillRoot, d.file);
        applied.push({ target, before: readFileSync(target, "utf8") });
        writeFileSync(target, d.content);
      }
      const pendingCatalog = JSON.parse(readFileSync(join(skillRoot, ".claude", "skills", "_shared", "skill-checks.json"), "utf8"));
      const { findings } = await checkSkills(skillRoot);
      const regression = runRegression(runs, pendingCatalog, casesDir);
      result.regression_results = { passed: regression.passed, failed: regression.failed, new_case: null };
      if (findings.length || regression.failed) {
        for (const a of applied) writeFileSync(a.target, a.before);
        result.verdict = "REJECTED";
        result.rejected_reason = findings.length ? `check:skills rot (${findings[0].pruefung}: ${findings[0].detail})` : `Regression rot (${regression.failed} Fälle)`;
        return result;
      }
      // Neuer Regressionsfall aus den belegenden Runs (anonymisiert, check:secrets-frei zu halten).
      for (const l of result.lessons) {
        if (!l.diffs.length || !l.evidence.length) continue;
        const caseFile = join(casesDir, "cases", `curated-${l.id}.json`);
        writeFileSync(caseFile, JSON.stringify({ generated_by: "skill-curate", rule_id: l.id, evidence_runs: l.evidence }, null, 2) + "\n");
        result.regression_results.new_case = relative(REPO_ROOT, caseFile);
      }
    } catch (err) {
      for (const a of applied) { try { writeFileSync(a.target, a.before); } catch { /* revert best effort */ } }
      result.verdict = "REJECTED";
      result.rejected_reason = err.message;
      return result;
    }
    result.verdict = "ACCEPTED";
    const msg = `. e skills: Kur-Lektion ${result.lessons.map((l) => l.id).join(", ") || "Diff"} (max ${maxLessons}/Lauf)`;
    result.commit_message = checkSubject(msg) ? null : msg; // null bei Notationsverstoß: wird so nicht committet
  }

  // Cursor fortschreiben (nur wenn tatsächlich neue Runs verarbeitet wurden).
  if (newRuns.length) {
    mkdirSync(state, { recursive: true });
    writeFileSync(cursorPath, JSON.stringify({ seen: [...seen, ...newRuns.map((r) => r.sessionId)].sort(), updatedAt: new Date().toISOString() }, null, 2) + "\n");
  }
  return result;
}

// Klassifikationstabelle (Epics §3): Lint-Fund mit eindeutigem Fix → Diff;
// Regeltreffer ≥ minRuns Sessions → Regel-Kandidat; wiederkehrende Befehlsfolge →
// Skript-Kandidat (kein Diff); Fehler ohne Befehlsmuster → probabilistic (nur Vorschlag).
async function collectLessons(runs, catalog, { minRuns, skillRoot, state, apply }) {
  const lessons = [];
  // 1) Lint: nur Funde mit eindeutigem Fix (pruefung "fixed" aus check:skills --fix-Pfad).
  try {
    const { findings: lintFindings } = await checkSkills(skillRoot, { fix: apply });
    for (const f of lintFindings) {
      if (f.pruefung !== "fixed") continue;
      lessons.push({ id: `lint-${f.skill}`, classification: "deterministic", evidence: [f.skill], action: "diff", diffs: [`lint-fix: ${f.detail}`] });
    }
  } catch { /* Root ohne Skills */ }
  // 2) Regeltreffer (unguarded) über >= minRuns verschiedene Sessions.
  const byRule = new Map();
  for (const h of evaluateRuns(runs, catalog)) {
    if (h.guard) continue;
    if (!byRule.has(h.ruleId)) byRule.set(h.ruleId, new Set());
    byRule.get(h.ruleId).add(h.sessionId);
  }
  for (const [ruleId, sessions] of [...byRule].sort()) {
    if (sessions.size >= minRuns) lessons.push({ id: ruleId, classification: "deterministic", evidence: [...sessions].sort(), action: "regel-kandidat" });
  }
  // 3) Wiederkehrende Befehlsfolgen (Mining): Kandidat, kein Diff.
  for (const c of mineSequences(runs, { minHits: 3, minSessions: 2 })) {
    lessons.push({ id: `seq-${c.gram.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}`, classification: "deterministic", evidence: c.sessions, action: "skript-kandidat", suggestion: c.suggestion });
  }
  // 4) Fehler ohne Befehlsmuster über >= minRuns Sessions: probabilistisch, nur Vorschlag.
  const unmatched = new Map();
  const rules = Object.entries(catalog).filter(([k]) => k !== "$config").flatMap(([, v]) => v);
  for (const run of runs) {
    for (const c of run.commands) {
      if (!c.error) continue;
      const hasPattern = rules.some((r) => r.match && new RegExp(r.match).test(c.cmd));
      if (hasPattern) continue;
      if (!unmatched.has(c.error)) unmatched.set(c.error, new Set());
      unmatched.get(c.error).add(run.sessionId);
    }
  }
  for (const [cls, sessions] of [...unmatched].sort()) {
    if (sessions.size >= minRuns) {
      const lesson = { id: `prob-${cls}`, classification: "probabilistic", evidence: [...sessions].sort(), action: "vorschlag" };
      // Probabilistische Lektionen: nur Vorschlag mit Beleg unter <state>/proposals/, nie ein Diff.
      mkdirSync(join(state, "proposals"), { recursive: true });
      writeFileSync(join(state, "proposals", `${lesson.id}.json`), JSON.stringify({ ...lesson, generated_by: "skill-curate" }, null, 2) + "\n");
      lessons.push(lesson);
    }
  }
  return lessons;
}

// Regression: alle Fälle in cases/ gegen den (ggf. geänderten) Katalog; erwartet wird
// Treffer bzw. kein Treffer laut expected.json.
function runRegression(runs, catalog, casesDir) {
  const expected = JSON.parse(readFileSync(join(casesDir, "expected.json"), "utf8"));
  let passed = 0, failed = 0;
  for (const [ruleId, exp] of Object.entries(expected)) {
    for (const [side, want] of Object.entries(exp)) {
      let run;
      try { run = JSON.parse(readFileSync(join(casesDir, "cases", `${ruleId}.${side}.json`), "utf8")); } catch { failed++; continue; }
      const hits = evaluateRuns([run], catalog).filter((h) => h.ruleId === ruleId);
      const hit = hits.some((h) => !h.guard);
      const guard = hits.some((h) => h.guard);
      const ok = want === "hit" ? hit : want === "nohit-guarded" ? guard && !hit : !hit && !guard;
      if (ok) passed++; else failed++;
    }
  }
  return { passed, failed };
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      if (["json", "apply"].includes(k)) args[k] = true; else args[k] = argv[++i];
    } else args._.push(argv[i]);
  }
  return args;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  try {
    const result = await curate({ root: a.root, runs: a.runs, project: a.project, since: a.since, apply: a.apply, diffFile: a["diff-file"], stateDir: a.state });
    mkdirSync(join(a.root ?? join(REPO_ROOT, "data"), "data", "skill-curation"), { recursive: true });
    const reportPath = join(a.state ?? join(a.root ?? join(REPO_ROOT, "data"), "data", "skill-curation"), `report-${new Date().toISOString().replace(/[:]/g, "-")}.json`);
    writeFileSync(reportPath, JSON.stringify(result, null, 2) + "\n");
    if (a.json) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    else {
      process.stdout.write(`# skill-curate: ${result.verdict}\n\n`);
      for (const l of result.lessons) process.stdout.write(`- ${l.classification} ${l.id} (${l.evidence.length} Belege)\n`);
      if (result.rejected_reason) process.stdout.write(`Grund: ${result.rejected_reason}\n`);
    }
    process.stderr.write(`Report: ${reportPath}\n`);
    return result.verdict === "REJECTED" ? 2 : result.lessons.length ? 1 : 0;
  } catch (err) {
    process.stderr.write(`skill-curate: ${err.message}\n`);
    return 2;
  }
}

if (process.argv[1] && process.argv[1].endsWith("skill-curate.mjs")) process.exit(await main());
