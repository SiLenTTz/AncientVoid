import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

/**
 * T1.5-10 — skill/agent discovery for the launcher overlay. Source is the
 * TARGET PROJECT itself (Nutzer-Rückfrage 1: not a hub-wide registry),
 * scanning the same `.claude/skills/`/`.claude/agents/` convention this
 * very repo uses.
 *
 * Workflows are read from `.claude/workflows/*.md` when that directory
 * exists. ADR-0005 found no adapter invocation for them, so a workflow
 * is never passed as a session arg — the UI puts the name in the prompt.
 */
export interface SkillOrAgent {
  kind: "skill" | "agent" | "workflow";
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

  try {
    const workflowsDir = join(projectPath, ".claude", "workflows");
    const entries = await readdir(workflowsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const meta = await readFrontmatter(join(workflowsDir, entry.name));
      if (!meta) continue;
      items.push({
        kind: "workflow",
        name: meta.name ?? entry.name.replace(/\.md$/, ""),
        description: meta.description ?? "",
      });
    }
  } catch {
    // no .claude/workflows directory — not an error.
  }

  return items;
}

const STOP = new Set(
  "und oder der die das ein eine fuer mit auf ist sind nicht wenn dann nach vor dem des zum zur von als auch nur dass sich wir ich du es im zu am an so wie bei aus ueber unter den einen einem einer bitte noch schon kann soll sollte wird werden dieser diese dieses aber the and for with this that from into your you are was were has have been not but eintrag projekt".split(
    " ",
  ),
);

function fold(value: string): string {
  return value.toLowerCase().replaceAll("ä", "ae").replaceAll("ö", "oe").replaceAll("ü", "ue").replaceAll("ß", "ss");
}

function tokens(value: string): string[] {
  return fold(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !STOP.has(token));
}

function slugify(value: string): string {
  const slug = fold(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "vorschlag";
}

export interface PromptRecommendation {
  mode: "match" | "create";
  kind: "skill" | "agent" | "workflow";
  name: string;
  description: string;
  reason: string;
  /** Markdown for a new file. Null when `mode` is `match`. */
  draft: string | null;
}

function kindRank(kind: SkillOrAgent["kind"]): number {
  if (kind === "skill") return 0;
  if (kind === "agent") return 1;
  return 2;
}

function proposeKind(text: string): SkillOrAgent["kind"] {
  const folded = fold(text);
  if (/\bworkflow\b|\barbeitsablauf\b|\bablauf\b/.test(folded)) return "workflow";
  if (/\bagent\b/.test(folded) && !/\bskill\b/.test(folded)) return "agent";
  return "skill";
}

function oneLine(value: string, max: number): string {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
}

function draftFor(kind: SkillOrAgent["kind"], name: string, description: string, text: string): string {
  const title = kind === "skill" ? "Skill" : kind === "agent" ? "Agent" : "Workflow";
  const quoted = description.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `---\nname: ${name}\ndescription: "${quoted}"\n---\n\n# ${title}: ${name}\n\nVorschlag aus einem verbesserten Prompt. Vor dem ersten Lauf anpassen.\n\n${text.trim()}\n`;
}

/**
 * Picks an existing skill, agent, or workflow whose name or description
 * shares words with the prompt. Otherwise proposes a new file. No model
 * call — the enhance step already spent the quota.
 */
export function recommendForPrompt(text: string, items: readonly SkillOrAgent[]): PromptRecommendation {
  const folded = fold(text);
  const textTokens = tokens(text);
  const ranked = items
    .map((item) => {
      const name = fold(item.name);
      const nameParts = tokens(item.name.replaceAll("-", " "));
      const described = new Set(tokens(`${item.name} ${item.description}`));
      const hits: string[] = [];
      let score = 0;
      if (name.length >= 3 && folded.includes(name)) {
        score += 5;
        hits.push(item.name);
      }
      for (const part of nameParts) {
        if (textTokens.includes(part)) {
          score += 3;
          hits.push(part);
        }
      }
      for (const token of textTokens) {
        if (described.has(token) && !nameParts.includes(token)) {
          score += 1;
          hits.push(token);
        }
      }
      return { item, score, hits: [...new Set(hits)] };
    })
    .filter((row) => row.score >= 3)
    .sort((a, b) => b.score - a.score || kindRank(a.item.kind) - kindRank(b.item.kind) || a.item.name.localeCompare(b.item.name));

  const best = ranked[0];
  if (best) {
    const shown = best.hits.slice(0, 3).join(", ");
    return {
      mode: "match",
      kind: best.item.kind,
      name: best.item.name,
      description: best.item.description,
      reason: shown ? `Trifft ${shown}.` : "Passt zum Prompt.",
      draft: null,
    };
  }

  const kind = proposeKind(text);
  const ziel = text.match(/Ziel:\s*(.+)/i);
  const source = (ziel?.[1] ?? text).split("\n")[0] ?? text;
  let name = slugify(tokens(source).slice(0, 4).join(" "));
  const taken = new Set(items.map((item) => item.name));
  if (taken.has(name)) {
    let n = 2;
    while (taken.has(`${name}-${n}`)) n += 1;
    name = `${name}-${n}`;
  }
  const description = oneLine(ziel?.[1] ?? text, 180);
  return {
    mode: "create",
    kind,
    name,
    description,
    reason: "Kein Skill, Agent oder Workflow im Projekt passt.",
    draft: draftFor(kind, name, description, text),
  };
}

const ARTIFACT_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function artifactRelative(kind: SkillOrAgent["kind"], name: string): string {
  switch (kind) {
    case "skill":
      return join(".claude", "skills", name, "SKILL.md");
    case "agent":
      return join(".claude", "agents", `${name}.md`);
    case "workflow":
      return join(".claude", "workflows", `${name}.md`);
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

/** Writes a new skill, agent, or workflow under the project. Refuses to overwrite. */
export async function writeProjectArtifact(
  projectPath: string,
  item: { kind: SkillOrAgent["kind"]; name: string; draft: string },
): Promise<{ path: string }> {
  if (!ARTIFACT_NAME.test(item.name)) throw new Error("invalid artifact name");
  if (item.draft.length === 0 || item.draft.length > 8000) throw new Error("draft too large");
  const root = resolve(projectPath);
  const relative = artifactRelative(item.kind, item.name);
  const full = resolve(root, relative);
  if (full !== root && !full.startsWith(root + sep)) throw new Error("artifact path escapes the project");
  await mkdir(dirname(full), { recursive: true });
  try {
    await writeFile(full, item.draft.endsWith("\n") ? item.draft : `${item.draft}\n`, { flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") throw new Error("artifact already exists");
    throw err;
  }
  return { path: relative };
}
