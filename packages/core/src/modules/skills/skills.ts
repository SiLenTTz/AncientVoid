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
  /** Other skill names this one specializes. Empty means it stands alone. */
  extends?: string[];
  /** `base` lives next to every project. Omitted means the skill is in the project. */
  layer?: "base" | "project";
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
function unquote(value: string): string {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}

function parseFrontmatter(content: string): { name?: string; description?: string; extends?: string[] } | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const block = match[1]!;
  const lines = block.split(/\r?\n/);
  const result: { name?: string; description?: string; extends?: string[] } = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const nameMatch = line.match(/^name:\s*(.*)$/);
    if (nameMatch) result.name = unquote(nameMatch[1]!.trim());
    const extendsMatch = line.match(/^extends:\s*(.*)$/);
    if (extendsMatch) {
      const names = extendsMatch[1]!.split(",").map((part) => unquote(part.trim())).filter((part) => part.length > 0);
      if (names.length > 0) result.extends = names;
    }
    const descMatch = line.match(/^description:\s*(.*)$/);
    if (!descMatch) continue;
    const rest = descMatch[1]!.trim();
    const blockScalar = rest.match(/^([|>])([+-]?)$/);
    if (!blockScalar) {
      result.description = unquote(rest);
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

async function readFrontmatter(filePath: string): Promise<{ name?: string; description?: string; extends?: string[] } | null> {
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
function withExtends(
  item: { kind: SkillOrAgent["kind"]; name: string; description: string },
  meta: { extends?: string[] },
  layer?: SkillOrAgent["layer"],
): SkillOrAgent {
  return {
    ...item,
    ...(meta.extends && meta.extends.length > 0 ? { extends: meta.extends } : {}),
    ...(layer === "base" ? { layer } : {}),
  };
}

export async function scanProjectSkills(
  projectPath: string,
  options?: { baseRoot?: string },
): Promise<SkillOrAgent[]> {
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
      items.push(withExtends({ kind: "skill", name: meta.name ?? entry.name, description: meta.description ?? "" }, meta));
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

  const baseRoot = options?.baseRoot;
  if (baseRoot && resolve(baseRoot) !== resolve(projectPath)) {
    try {
      const skillsDir = join(baseRoot, ".claude", "skills");
      const entries = await readdir(skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const meta = await readFrontmatter(join(skillsDir, entry.name, "SKILL.md"));
        if (!meta) continue;
        items.push(
          withExtends(
            { kind: "skill", name: meta.name ?? entry.name, description: meta.description ?? "" },
            meta,
            "base",
          ),
        );
      }
    } catch {
      // no base catalog yet
    }
  }

  return items;
}

const STOP = new Set(
  "und oder der die das ein eine fuer mit auf ist sind nicht wenn dann nach vor dem des zum zur von als auch nur dass sich wir ich du es im zu am an so wie bei aus ueber unter den einen einem einer bitte noch schon kann soll sollte wird werden dieser diese dieses aber the and for with this that from into your you are was were has have been not but eintrag projekt ziel scope constraints erfolgskriterium aufgabe".split(
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

function layerRank(item: SkillOrAgent): number {
  return item.layer === "base" ? 1 : 0;
}

function kindRank(kind: SkillOrAgent["kind"]): number {
  if (kind === "skill") return 0;
  if (kind === "agent") return 1;
  return 2;
}

/** Only an explicit request creates something new — a one-off prompt is not
 * a skill (user feedback 2026-09-23: drafts were just the prompt again). */
function asksForArtifact(text: string): boolean {
  const folded = fold(text);
  return (
    /\b(skill|agent|workflow|arbeitsablauf)\b/.test(folded) &&
    /\b(lege|leg|anlegen|erstelle|erstell|erstellen|baue|bau|bauen|schreibe|schreib|beschreibe|definiere|neuen?|create|add|make)\b/.test(folded)
  );
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

/** Words that ask for the artifact, not what it is about. */
const REQUEST_WORDS = new Set(
  "lege leg anlegen erstelle erstell erstellen baue bau bauen schreibe schreib beschreibe definiere neuen neue skill agent workflow arbeitsablauf create add make".split(" "),
);

function nameTokens(source: string): string[] {
  return tokens(source).filter((token) => !REQUEST_WORDS.has(token)).slice(0, 4);
}

function uniqueName(source: string, items: readonly SkillOrAgent[]): string {
  let name = slugify(nameTokens(source).join(" "));
  const taken = new Set(items.map((item) => item.name));
  if (taken.has(name)) {
    let n = 2;
    while (taken.has(`${name}-${n}`)) n += 1;
    name = `${name}-${n}`;
  }
  return name;
}

function promptDelta(text: string): string {
  const ziel = text.match(/Ziel:?\s*([\s\S]*?)(?:\n\s*\n|\nScope\b|$)/i);
  return oneLine((ziel?.[1] ?? text.split("\n")[0] ?? text).trim(), 400);
}

function extendBase(base: SkillOrAgent, text: string, items: readonly SkillOrAgent[]): PromptRecommendation {
  const delta = promptDelta(text);
  const name = uniqueName(delta, items);
  const description = oneLine(delta, 180);
  const quoted = description.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return {
    mode: "create",
    kind: "skill",
    name,
    description,
    reason: `Erweitert den Base-Skill ${base.name}. Nur die Abweichung wird im Projekt angelegt.`,
    draft: `---\nname: ${name}\ndescription: "${quoted}"\nextends: ${base.name}\n---\n\n# Skill: ${name}\n\nErweitert \`${base.name}\`. Die gemeinsame Form bleibt im Base-Skill. Hier steht nur die Abweichung.\n\n## Abweichung\n\n${delta}\n`,
  };
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
/**
 * A recommendation only when it makes sense: an existing skill, agent or
 * workflow with clear evidence (its name in the prompt, or at least two
 * distinct words from name and description), or a new one when the prompt
 * explicitly asks for it. Otherwise null — no draft built from the prompt.
 */
export function recommendForPrompt(text: string, items: readonly SkillOrAgent[]): PromptRecommendation | null {
  const folded = fold(text);
  const textTokens = tokens(text);
  const ranked = items
    .map((item) => {
      const name = fold(item.name);
      const nameParts = tokens(item.name.replaceAll("-", " "));
      const described = new Set(tokens(`${item.name} ${item.description}`));
      const hits: string[] = [];
      let score = 0;
      const named = name.length >= 3 && new RegExp(`(^|[^a-z0-9])${name.replace(/[^a-z0-9]/g, "[^a-z0-9]?")}([^a-z0-9]|$)`).test(folded);
      if (named) {
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
      // Long enhanced prompts share stray words with any description. Without
      // the name: three distinct shared words, or two that cover at least
      // half of a short description.
      const descriptionWords = [...described].filter((token) => !nameParts.includes(token));
      const covered = descriptionWords.filter((token) => textTokens.includes(token)).length;
      const coverage = descriptionWords.length > 0 ? covered / descriptionWords.length : 0;
      return { item, score, hits: [...new Set(hits)], named, coverage };
    })
    .filter((row) => row.named || row.hits.length >= 3 || (row.hits.length >= 2 && row.coverage >= 0.5))
    .sort(
      (a, b) =>
        b.score - a.score ||
        layerRank(a.item) - layerRank(b.item) ||
        kindRank(a.item.kind) - kindRank(b.item.kind) ||
        a.item.name.localeCompare(b.item.name),
    );

  const best = ranked[0];
  if (best && best.item.layer !== "base") {
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

  if (best && !asksForArtifact(text)) {
    const shown = best.hits.slice(0, 3).join(", ");
    return {
      mode: "match",
      kind: best.item.kind,
      name: best.item.name,
      description: best.item.description,
      reason: `Basis-Skill, trifft ${shown}.`,
      draft: null,
    };
  }

  if (!asksForArtifact(text)) return null;
  const kind = proposeKind(text);
  const task = items.find((item) => item.layer === "base" && item.kind === "skill" && item.name === "task");
  if (task && kind === "skill") return extendBase(task, text, items);
  const ziel = text.match(/Ziel:\s*(.+)/i);
  const source = (ziel?.[1] ?? text).split("\n")[0] ?? text;
  let name = slugify(nameTokens(source).join(" "));
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
    reason: "Der Prompt bittet darum, das anzulegen.",
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
    if ((err as NodeJS.ErrnoException).code === "EEXIST") throw new Error("artifact already exists", { cause: err });
    throw err;
  }
  return { path: relative };
}

export interface ResolvedSkillChain {
  /** Ancestor first, selected skill last. */
  names: string[];
  /** Prompt text. Events keep the names only — this body must stay out of them. */
  block: string;
}

const CHAIN_BLOCK_MAX = 12_000;

function bodyAfterFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return (match ? content.slice(match[0].length) : content).trim();
}

/** Nearest ancestor of the project that already has a skill catalog. */
async function findSkillCatalogRoot(projectPath: string): Promise<string | undefined> {
  let dir = dirname(resolve(projectPath));
  while (true) {
    try {
      await readdir(join(dir, ".claude", "skills"));
      return dir;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return undefined;
      dir = parent;
    }
  }
}

async function readSkillMarkdown(root: string, name: string): Promise<string | null> {
  try {
    return await readFile(join(root, ".claude", "skills", name, "SKILL.md"), "utf8");
  } catch {
    return null;
  }
}

/**
 * Loads a skill and its `extends` parents. The project file wins over the
 * catalog. A missing selected skill returns null so the caller can fail
 * loudly. A missing parent stays in the block as `fehlt:` and does not
 * abort the rest of the chain. Cycles are cut.
 */
export async function resolveSkillChain(projectPath: string, skillName: string): Promise<ResolvedSkillChain | null> {
  const project = resolve(projectPath);
  const baseRoot = await findSkillCatalogRoot(project);
  const cache = new Map<string, { extends: string[]; body: string | null }>();

  async function readNode(name: string): Promise<{ extends: string[]; body: string | null }> {
    const cached = cache.get(name);
    if (cached) return cached;
    const local = await readSkillMarkdown(project, name);
    const raw = local ?? (baseRoot ? await readSkillMarkdown(baseRoot, name) : null);
    const meta = raw ? parseFrontmatter(raw) : null;
    const node = { extends: meta?.extends ?? [], body: raw ? bodyAfterFrontmatter(raw) : null };
    cache.set(name, node);
    return node;
  }

  const names: string[] = [];
  const sections: string[] = [];
  const missing: string[] = [];
  const placed = new Set<string>();

  async function visit(name: string, stack: string[]): Promise<void> {
    if (placed.has(name) || stack.includes(name)) return;
    const node = await readNode(name);
    const next = [...stack, name];
    for (const parent of node.extends) await visit(parent, next);
    if (placed.has(name)) return;
    placed.add(name);
    if (node.body === null) {
      missing.push(name);
      return;
    }
    names.push(name);
    sections.push(`### ${name}\n${node.body}`);
  }

  await visit(skillName, []);
  if (!names.includes(skillName)) return null;

  const gap = missing.length > 0 ? `\nfehlt: ${missing.join(", ")}` : "";
  let block = `Skill-Kette: ${names.join(" → ")}${gap}\n\n${sections.join("\n\n")}`;
  if (block.length > CHAIN_BLOCK_MAX) block = `${block.slice(0, CHAIN_BLOCK_MAX)}\n\n[Skill-Kette gekürzt]`;
  return { names, block };
}

export function withSkillChain(prompt: string, block: string): string {
  if (prompt.startsWith("Skill-Kette:")) return prompt;
  return prompt.length > 0 ? `${block}\n\n---\n${prompt}` : block;
}
