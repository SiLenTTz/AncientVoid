#!/usr/bin/env node
// check:skills — Lint für .claude/skills (EPIC-P72 T72.3, ADR-0100).
// Prüfungen: Frontmatter (name = Ordner), description 40–300, Body ≤ 8 000,
// Kette inkl. extends ≤ CHAIN_BLOCK_MAX (aus skills.ts gelesen), Summe der
// Beschreibungen ≤ Ratchet-Wert im Regelkatalog, relative Links und
// scripts/-Pfade existieren, npm-run-Nennung existiert, README-Tabelle
// vollständig, Regel-Anker wörtlich, Regel-ID in ≥ 1 expected.json.
// Ausgabe: eine Zeile je Befund, am Ende die Budget-Tabelle (Tokens = Zeichen/4,
// Schätzung). Exit 0/1/2 = ok/Befund/Fehler. --fix nur bei eindeutigen Renames.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, relative } from "node:path";

export const BODY_MAX = 8_000;
export const DESC_MIN = 40;
export const DESC_MAX = 300;

function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return null;
  const fm = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    const [, key, rest] = kv;
    if (rest === ">-" || rest === ">" || rest === "|-" || rest === "|") {
      const parts = [];
      while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1])) parts.push(lines[++i].trim());
      fm[key] = parts.join(rest.startsWith("|") ? "\n" : " ");
    } else {
      fm[key] = rest.replace(/^["']|["']$/g, "");
    }
  }
  return { data: fm, body: text.slice(m[0].length), consumed: m[0].length };
}

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function skillFileIfExists(root, name) {
  const f = join(root, ".claude", "skills", name, "SKILL.md");
  return existsSync(f) ? [readFileSync(f, "utf8")] : [];
}

function skillDirs(root) {
  const base = join(root, ".claude", "skills");
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter((d) => d !== "_shared" && existsSync(join(base, d, "SKILL.md")))
    .sort();
}

function chainBlockMax(root) {
  const src = join(root, "packages", "core", "src", "modules", "skills", "skills.ts");
  const m = existsSync(src) && /CHAIN_BLOCK_MAX\s*=\s*([\d_]+)/.exec(readFileSync(src, "utf8"));
  return m ? Number(m[1].replace(/_/g, "")) : null;
}

function readCatalog(root) {
  const p = join(root, ".claude", "skills", "_shared", "skill-checks.json");
  if (!existsSync(p)) return { config: {}, rules: {} };
  const doc = JSON.parse(readFileSync(p, "utf8"));
  const { $config = {}, ...rules } = doc;
  return { config: $config, rules };
}

function repoScripts(root) {
  const names = new Set();
  const files = [join(root, "package.json"), ...walk(join(root, "packages")), ...walk(join(root, "apps"))];
  for (const f of files.filter((f) => f.endsWith("package.json"))) {
    try {
      for (const k of Object.keys(JSON.parse(readFileSync(f, "utf8")).scripts ?? {})) names.add(k);
    } catch { /*(ignore)*/ }
  }
  return names;
}

function gitFixTarget(root, brokenRel) {
  // Genau ein Rename-Ziel -> fixbar; mehrere -> mehrdeutig (bleibt unangetastet).
  // git log --follow meldet den Uebertritt pfadseitig als D; das Ziel liegt in
  // den R-Zeilen des betreffenden Commits (name-status ohne Pfadfilter).
  try {
    const out = execFileSync("git", ["log", "--follow", "-M", "--diff-filter=ADR", "--name-status", "--format=commit:%h", "--", brokenRel], { cwd: root, encoding: "utf8" });
    const targets = new Set();
    let current = null;
    for (const line of out.split("\n")) {
      if (line.startsWith("commit:")) current = line.slice(7).trim();
      if (line.startsWith("R")) targets.add(line.split("\t").at(-1));
      else if (line.startsWith("D\t") && current) {
        const shown = execFileSync("git", ["show", "--format=", "--name-status", current], { cwd: root, encoding: "utf8" });
        for (const l of shown.split("\n")) if (l.startsWith("R") && l.includes(brokenRel)) targets.add(l.split("\t").at(-1));
      }
    }
    return targets.size === 1 ? [...targets][0] : null;
  } catch {
    return null;
  }
}

function gitNpmRename(root, missing) {
  // Eindeutiger Rename nur wenn genau ein Commit das Removal bringt und dabei
  // genau einen neuen Script-Key anlegt.
  try {
    const commits = execFileSync("git", ["log", "-S", `"${missing}":`, "--format=%H", "--", "package.json"], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean);
    const esc = missing.replace(/[.*+?^${}()|[\]\\]/g, (c) => "\\" + c);
    const removals = [];
    for (const c of commits) {
      const diff = execFileSync("git", ["show", "--format=", "--unified=0", c, "--", "package.json"], { cwd: root, encoding: "utf8" });
      if (new RegExp("^-\\s*\"" + esc + "\"", "m").test(diff)) removals.push(diff);
    }
    if (removals.length !== 1) return null;
    const added = [...removals[0].matchAll(/^\+\s*"([\w:.-]+)"\s*:/gm)].map((m) => m[1]);
    return added.length === 1 ? added[0] : null;
  } catch {
    return null;
  }
}

export async function checkSkills(root, { fix = false } = {}) {
  const findings = [];
  const budgets = [];
  const fixable = [];
  const skills = skillDirs(root);
  const catalog = readCatalog(root);
  const knownScripts = repoScripts(root);
  const exempt = new Set((catalog.config.npmRunExemptBySkill?.["*"] ?? []).concat(catalog.config.npmRunExemptBySkill?.factory ?? []));

  for (const name of skills) {
    const file = join(root, ".claude", "skills", name, "SKILL.md");
    const text = readFileSync(file, "utf8");
    const fm = parseFrontmatter(text);
    let body = text;
    if (!fm) {
      findings.push({ skill: name, pruefung: "frontmatter", detail: "fehlt" });
    } else {
      if (fm.data.name !== name) findings.push({ skill: name, pruefung: "frontmatter-name", detail: `${fm.data.name ?? "-"}/${name}` });
      const desc = fm.data.description ?? "";
      if (desc.length < DESC_MIN || desc.length > DESC_MAX) findings.push({ skill: name, pruefung: "description", detail: `${desc.length}/${DESC_MIN}-${DESC_MAX}` });
      else budgets.push({ skill: name, chars: desc.length, kind: "description" });
      body = fm.body;
    }
    if (body.length > BODY_MAX) findings.push({ skill: name, pruefung: "body", detail: `${body.length}/${BODY_MAX}` });

    // Kette inkl. extends (Näherung: Summe der Bodies + Format-Overhead je Glied).
    const max = chainBlockMax(root);
    if (max && fm?.data.extends) {
      let total = body.length;
      const seen = new Set([name]);
      const queue = String(fm.data.extends).split(",").map((s) => s.trim()).filter(Boolean);
      for (const q of queue) {
        if (seen.has(q)) continue;
        seen.add(q);
        const f = join(root, ".claude", "skills", q, "SKILL.md");
        if (existsSync(f)) total += (parseFrontmatter(readFileSync(f, "utf8"))?.body.length ?? 0) + 20;
        else total += 20;
      }
      if (total > max) findings.push({ skill: name, pruefung: "kette", detail: `${total}/${max}` });
    }

    // Relative Links und scripts/-Pfade.
    const linkBase = dirname(file);
    for (const m of body.matchAll(/\[[^\]]*\]\((?!https?:|#|mailto:)([^)\s]+)\)/g)) {
      const target = m[1].split("#")[0];
      if (!target) continue;
      if (!existsSync(join(linkBase, target))) {
        const rel = relative(root, join(linkBase, target)).split("\\").join("/");
        const hit = fix ? gitFixTarget(root, rel) : null;
        if (hit) fixable.push({ file, from: m[1], to: relative(linkBase, join(root, hit)).split("\\").join("/") });
        else findings.push({ skill: name, pruefung: "link", detail: `→ ${rel}` });
      }
    }
    for (const m of body.matchAll(/`?(scripts\/[\w./-]+\.\w+)/g)) {
      const rel = m[1].replace(/\/$/, "");
      if (!existsSync(join(root, rel))) {
        const hit = fix ? gitFixTarget(root, rel) : null;
        if (hit) fixable.push({ file, from: m[1], to: relative(root, join(root, hit)).split("\\").join("/") });
        else findings.push({ skill: name, pruefung: "skript-pfad", detail: rel });
      }
    }
    for (const m of body.matchAll(/npm run ([a-z0-9:_-]+)/g)) {
      if (knownScripts.has(m[1]) || exempt.has(m[1])) continue;
      const renamed = fix ? gitNpmRename(root, m[1]) : null;
      if (renamed) fixable.push({ file, from: `npm run ${m[1]}`, to: `npm run ${renamed}` });
      else findings.push({ skill: name, pruefung: "npm-run", detail: m[1] });
    }
  }

  // Ratchet: Summe aller Beschreibungen.
  const budgetTotal = catalog.config.descriptionBudgetTotal;
  if (typeof budgetTotal === "number") {
    let sum = 0;
    for (const name of skills) {
      const fm = parseFrontmatter(readFileSync(join(root, ".claude", "skills", name, "SKILL.md"), "utf8"));
      const d = fm?.data.description ?? "";
      sum += Math.min(d.length, DESC_MAX); // überlange zählen oben ohnehin als Befund
    }
    if (sum > budgetTotal) findings.push({ skill: "(summe)", pruefung: "description-ratchet", detail: `${sum}/${budgetTotal}` });
    else budgets.push({ skill: "(summe)", chars: sum, kind: `ratchet ≤ ${budgetTotal}` });
  }

  // README-Tabelle.
  const readmePath = join(root, ".claude", "skills", "README.md");
  if (existsSync(readmePath)) {
    const readme = readFileSync(readmePath, "utf8");
    for (const name of skills) {
      if (!readme.includes(`(${name}/SKILL.md)`)) findings.push({ skill: name, pruefung: "readme-tabelle", detail: "Skill fehlt in .claude/skills/README.md" });
    }
  }

  // Regelkatalog: Anker wörtlich, ID in ≥ 1 expected.json.
  const anchorSources = [join(root, "AGENTS.md"), join(root, "CONTRIBUTING.md")]
    .filter(existsSync)
    .map((f) => readFileSync(f, "utf8"))
    .concat([...walk(join(root, "docs"))].filter((f) => f.endsWith(".md")).map((f) => readFileSync(f, "utf8")));
  const expectedFiles = [...walk(join(root, "scripts", "skill-regression")), ...walk(join(root, ".claude", "skills", "_shared", "fixtures"))].filter((f) => f.endsWith("expected.json"));
  const expectedBlob = expectedFiles.map((f) => readFileSync(f, "utf8")).join("\n");
  for (const [skill, rules] of Object.entries(catalog.rules)) {
    for (const rule of rules ?? []) {
      if (rule.anchor) {
        const srcs = rule.source && rule.source !== "skill" ? [join(root, rule.source)].filter(existsSync).map((f) => readFileSync(f, "utf8")) : anchorSources.concat(skillFileIfExists(root, skill));
        if (!srcs.some((src) => src.includes(rule.anchor))) {
          findings.push({ skill, pruefung: "regel-anke", detail: `${rule.id}: Anker nicht in Quelle gefunden` });
        }
      }
      if (rule.id && !expectedBlob.includes(rule.id)) {
        findings.push({ skill, pruefung: "regel-fixture", detail: `${rule.id}: keine expected.json mit dieser Regel-ID` });
      }
    }
  }

  if (fix) {
    for (const f of fixable) {
      let text = readFileSync(f.file, "utf8");
      text = text.split(f.from).join(f.to);
      await import("node:fs").then(({ writeFileSync }) => writeFileSync(f.file, text, "utf8"));
      findings.push({ skill: "(fix)", pruefung: "fixed", detail: `${f.from} → ${f.to}` });
    }
  }

  return { findings, budgets };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const fix = args.includes("--fix");
  try {
    const { findings, budgets } = await checkSkills(process.cwd(), { fix });
    for (const f of findings) console.log(`${f.skill} ${f.pruefung} ${f.detail}`);
    if (budgets.length) {
      console.log("\nBudget (Zeichen, ≈ Tokens = Zeichen/4 — Schätzung):");
      for (const b of budgets) console.log(`  ${b.skill}\t${b.chars}\t≈${Math.ceil(b.chars / 4)}\t${b.kind}`);
    }
    const real = findings.filter((f) => f.pruefung !== "fixed");
    if (!real.length) console.log(`check:skills: OK (${skillsCount(process.cwd())} Skills)`);
    process.exit(real.length ? 1 : 0);
  } catch (err) {
    console.error(`check:skills: FEHLER ${err.message}`);
    process.exit(2);
  }
}

function skillsCount(root) {
  return skillDirs(root).length;
}
