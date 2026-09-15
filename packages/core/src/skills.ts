import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * T1.5-10 — skill/agent discovery for the launcher overlay. Source is the
 * TARGET PROJECT itself (Nutzer-Rückfrage 1: not a hub-wide registry),
 * scanning the same `.claude/skills/`/`.claude/agents/` convention this
 * very repo uses.
 *
 * `kind: "workflow"` is deliberately never produced here — ADR-0005/EPIC-P1.5
 * §3.5 found no verified "workflow" convention anywhere (`.claude/` has
 * exactly `skills/` and `agents/`). Reserved in the type, not invented in
 * the scanner.
 */
export interface SkillOrAgent {
  kind: "skill" | "agent";
  name: string;
  description: string;
}

/**
 * Minimal, line-based frontmatter reader — not a full YAML parser. Almost
 * every real file in this repo's own `.claude/skills/<name>/SKILL.md` and
 * `.claude/agents/*.md` uses single-line `key: value` frontmatter for
 * `name`/`description`; a real YAML dependency would be solving a problem
 * that doesn't exist yet. The one real exception found (bug-report/SKILL.md)
 * uses a folded block scalar (`description: >-`) with indented continuation
 * lines, so that one shape is handled explicitly below rather than adding a
 * full YAML parser for a single file.
 */
function parseFrontmatter(content: string): { name?: string; description?: string } | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const block = match[1]!;
  const lines = block.split(/\r?\n/);
  const result: { name?: string; description?: string } = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const nameMatch = line.match(/^name:\s*(.*)$/);
    if (nameMatch) result.name = nameMatch[1]!.trim();
    const descMatch = line.match(/^description:\s*(.*)$/);
    if (!descMatch) continue;
    const rest = descMatch[1]!.trim();
    const blockScalar = rest.match(/^([|>])([+-]?)$/);
    if (!blockScalar) {
      result.description = rest;
      continue;
    }
    // Folded (">") joins continuation lines with spaces; literal ("|")
    // keeps line breaks. Continuation lines are everything indented
    // beneath this key, until a non-indented (or blank-then-dedent) line.
    const folded = blockScalar[1] === ">";
    const continuationLines: string[] = [];
    let j = i + 1;
    while (j < lines.length && (lines[j] === "" || /^\s+\S/.test(lines[j]!))) {
      continuationLines.push(lines[j]!.trim());
      j++;
    }
    result.description = folded ? continuationLines.join(" ").trim() : continuationLines.join("\n").trim();
    i = j - 1;
  }
  return result;
}

async function readFrontmatter(filePath: string): Promise<{ name?: string; description?: string } | null> {
  try {
    return parseFrontmatter(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Scans `<projectPath>/.claude/skills/` (each subdirectory with a
 * `SKILL.md`) and `<projectPath>/.claude/agents/` (each `*.md` file).
 * A project with no `.claude/` at all yields an empty list, never an
 * error — matches this project's own "no .claude, no skills" reality for
 * most target repos, not a misconfiguration.
 */
export async function scanProjectSkills(projectPath: string): Promise<SkillOrAgent[]> {
  const items: SkillOrAgent[] = [];

  try {
    const skillsDir = join(projectPath, ".claude", "skills");
    const entries = await readdir(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      // Real, observed exceptions (EPIC-P1.5 §3.5): `_shared/` has no
      // SKILL.md (helper dir, not a skill); `README.md` and
      // `skill-template.md` are loose files, not directories — the
      // isDirectory() check alone already excludes those two, and the
      // missing-SKILL.md check below excludes `_shared/` without a
      // special case.
      if (!entry.isDirectory()) continue;
      const meta = await readFrontmatter(join(skillsDir, entry.name, "SKILL.md"));
      if (!meta) continue;
      items.push({ kind: "skill", name: meta.name ?? entry.name, description: meta.description ?? "" });
    }
  } catch {
    // no .claude/skills directory — not an error, just nothing to offer.
  }

  try {
    const agentsDir = join(projectPath, ".claude", "agents");
    const entries = await readdir(agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const meta = await readFrontmatter(join(agentsDir, entry.name));
      if (!meta) continue;
      items.push({ kind: "agent", name: meta.name ?? entry.name.replace(/\.md$/, ""), description: meta.description ?? "" });
    }
  } catch {
    // no .claude/agents directory — not an error.
  }

  return items;
}
