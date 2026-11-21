import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkSkills } from "./check-skills.mjs";

// check:skills-Gate (EPIC-P72 T72.3): Jede Prüfung hat ihren gepflanzten
// Defekt-FALL und ihren positiven Gegenfall. --fix darf nur eindeutige Renames
// ziehen; ein mehrdeutigerRename bleibt rot und unangetastet.

let dir;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "check-skills-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const w = async (rel, content) => {
  await mkdir(join(dir, rel, ".."), { recursive: true });
  await writeFile(join(dir, rel), content, "utf8");
};

const skill = (name, desc, body) =>
  w(`.claude/skills/${name}/SKILL.md`, `---\nname: ${name}\ndescription: ${desc}\n---\n${body}\n`);
const readme = (...names) => w(".claude/skills/README.md", names.map((n) => `| [\`${n}\`](${n}/SKILL.md) | x | y | z |`).join("\n") + "\n");

describe("check-skills — statische Prüfungen", () => {
  it("grüner Grundzustand liefert keine Befunde", async () => {
    await skill("demo", "x".repeat(100), "Body.\n");
    await readme("demo");
    const { findings } = await checkSkills(dir);
    expect(findings).toEqual([]);
  });

  it("fehlendes Frontmatter, name ungleich Ordner, description 39/301 schlagen an; 40/300 nicht", async () => {
    await w(".claude/skills/nope/SKILL.md", "# ohne frontmatter\n");
    await w(".claude/skills/ordre/SKILL.md", "---\nname: anderer\ndescription: " + "x".repeat(100) + "\n---\nb\n");
    await skill("kurz", "x".repeat(39), "b");
    await skill("lang", "x".repeat(301), "b");
    await skill("min", "x".repeat(40), "b");
    await skill("max", "x".repeat(300), "b");
    await readme("nope", "ordre", "kurz", "lang", "min", "max");
    const { findings } = await checkSkills(dir);
    const hits = findings.map((f) => `${f.skill} ${f.pruefung}`);
    expect(hits).toContain("nope frontmatter");
    expect(hits).toContain("ordre frontmatter-name");
    expect(hits).toContain("kurz description");
    expect(hits).toContain("lang description");
    expect(hits.filter((h) => h.startsWith("min ") || h.startsWith("max "))).toEqual([]);
  });

  it("Body-Budget 8000: 8001 Zeichen schlagen an, 8000 nicht", async () => {
    await skill("rand", "x".repeat(100), "y".repeat(7999));
    await skill("drueber", "x".repeat(100), "y".repeat(8001));
    await readme("rand", "drueber");
    const { findings } = await checkSkills(dir);
    expect(findings.map((f) => `${f.skill} ${f.pruefung}`)).toEqual(["drueber body"]);
  });

  it("Kette inkl. extends gegen CHAIN_BLOCK_MAX aus skills.ts (gelesen, nicht kopiert)", async () => {
    await w("packages/core/src/modules/skills/skills.ts", "const CHAIN_BLOCK_MAX = 16_000;\n");
    const big = "z".repeat(7999);
    await skill("base", "x".repeat(100), big);
    await w(".claude/skills/chain/SKILL.md", `---\nname: chain\ndescription: ${"x".repeat(100)}\nextends: base\n---\n${big}\n`);
    await readme("base", "chain");
    const { findings } = await checkSkills(dir);
    // 8000 + 8000 + Overhead > 16000 ( fixtures-Konstante) -> muss anschlagen.
    expect(findings.map((f) => `${f.skill} ${f.pruefung}`)).toEqual(["chain kette"]);
  });

  it("Beschreibungs-Ratchet: Summe über $config schlägt an, drunter nicht", async () => {
    await skill("a", "x".repeat(100), "b");
    await skill("b2", "x".repeat(100), "b");
    await readme("a", "b2");
    await w(".claude/skills/_shared/skill-checks.json", JSON.stringify({ $config: { descriptionBudgetTotal: 150 } }));
    expect((await checkSkills(dir)).findings.map((f) => f.pruefung)).toContain("description-ratchet");
    await w(".claude/skills/_shared/skill-checks.json", JSON.stringify({ $config: { descriptionBudgetTotal: 200 } }));
    expect((await checkSkills(dir)).findings).toEqual([]);
  });

  it("toter Relativ-Link und fehlender scripts/-Pfad schlagen an", async () => {
    await skill("demo", "x".repeat(100), "[ok](README.md)\n[tot](../../docs/fehlt.md)\n`scripts/fehlt.mjs`\n");
    await w(".claude/skills/README.md", "| [`demo`](demo/SKILL.md) | x | y | z |\n");
    await w(".claude/skills/demo/README.md", "x\n");
    const { findings } = await checkSkills(dir);
    expect(findings.map((f) => `${f.skill} ${f.pruefung}`).sort()).toEqual(["demo link", "demo skript-pfad"]);
  });

  it("npm run x ohne Package.json-Skript schlägt an; bekannte nicht", async () => {
    await w("package.json", JSON.stringify({ scripts: { "check:vorhanden": "node x.mjs" } }));
    await skill("demo", "x".repeat(100), "npm run check:vorhanden\nnpm run check:unbekannt\n");
    await readme("demo");
    const { findings } = await checkSkills(dir);
    expect(findings).toEqual([{ skill: "demo", pruefung: "npm-run", detail: "check:unbekannt" }]);
  });

  it("$config-Ausnahme (factory e2e) unterdrückt den Befund", async () => {
    await w("package.json", JSON.stringify({ scripts: {} }));
    await skill("factory", "x".repeat(100), "npm run e2e\n");
    await readme("factory");
    await w(".claude/skills/_shared/skill-checks.json", JSON.stringify({ $config: { npmRunExemptBySkill: { factory: ["e2e"] } } }));
    expect((await checkSkills(dir)).findings).toEqual([]);
  });

  it("README-Tabelle: fehlender Skill-Eintrag schlägt an", async () => {
    await skill("demo", "x".repeat(100), "b");
    await w(".claude/skills/README.md", "| sonstwas | x | y | z |\n");
    const { findings } = await checkSkills(dir);
    expect(findings).toEqual([{ skill: "demo", pruefung: "readme-tabelle", detail: "Skill fehlt in .claude/skills/README.md" }]);
  });

  it("Regel-Anker fehlt wörtlich in der Quelle -> rot; vorhanden -> still; ID ohne expected.json -> rot", async () => {
    await skill("demo", "x".repeat(100), "Hier steht: Kein `--no-verify`.\n");
    await readme("demo");
    await w("AGENTS.md", "nichts Relevantes\n");
    await w(".claude/skills/_shared/skill-checks.json", JSON.stringify({
      $config: {},
      demo: [
        { id: "rule-mit", anchor: "Kein `--no-verify`", source: "skill" },
        { id: "rule-ohne", anchor: "Dieser Satz steht nirgends", source: "skill" },
      ],
    }));
    let findings = (await checkSkills(dir)).findings;
    expect(findings.map((f) => f.pruefung).sort()).toEqual(["regel-anke", "regel-fixture", "regel-fixture"]);
    expect(findings.find((f) => f.pruefung === "regel-anke").detail).toContain("rule-ohne");
    await w("scripts/skill-regression/cases/rule-mit/expected.json", JSON.stringify({ rule: "rule-mit", ok: true }));
    findings = (await checkSkills(dir)).findings;
    expect(findings.map((f) => `${f.pruefung} ${f.detail.split(":")[0]}`).sort()).toEqual(["regel-anke rule-ohne", "regel-fixture rule-ohne"]);
  });

  it("kaputte JSON im Katalog -> Exit-2-Pfad (Exception)", async () => {
    await skill("demo", "x".repeat(100), "b");
    await readme("demo");
    await w(".claude/skills/_shared/skill-checks.json", "{kaputt");
    await expect(checkSkills(dir)).rejects.toThrow();
  });
});

describe("check-skills --fix (nur eindeutige Renames)", () => {
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  beforeEach(async () => {
    git("init", "-q");
    git("config", "user.email", "t@t");
    git("config", "user.name", "t");
  });

  it("git mv mit eindeutigem Ziel wird gefixt", async () => {
    await w("docs/urprung.md", "x\n");
    await skill("demo", "x".repeat(100), "[link](../../../docs/urprung.md)\n");
    await readme("demo");
    git("add", "-A"); git("commit", "-qm", "init");
    git("mv", "docs/urprung.md", "docs/ziel.md");
    git("add", "-A"); git("commit", "-qm", "rename");
    const { findings } = await checkSkills(dir, { fix: true });
    expect(findings).toEqual([{ skill: "(fix)", pruefung: "fixed", detail: "../../../docs/urprung.md → ../../../docs/ziel.md" }]);
    expect(await readFile(join(dir, ".claude/skills/demo/SKILL.md"), "utf8")).toContain("(../../../docs/ziel.md)");
    expect((await checkSkills(dir)).findings).toEqual([]);
  });

  it("mehrdeutiger Rename (zwei Rename-Commits vomselben Pfad) bleibt rot und unangetastet", async () => {
    await w("docs/a.md", "x\n");
    await skill("demo", "x".repeat(100), "[link](../../../docs/a.md)\n");
    await readme("demo");
    git("add", "-A"); git("commit", "-qm", "init");
    git("mv", "docs/a.md", "docs/zz1.md");
    git("add", "-A"); git("commit", "-qm", "rename-1");
    await w("docs/a.md", "y\n");
    git("add", "-A"); git("commit", "-qm", "again");
    git("mv", "docs/a.md", "docs/zz2.md");
    git("add", "-A"); git("commit", "-qm", "rename-2");
    const before = await readFile(join(dir, ".claude/skills/demo/SKILL.md"), "utf8");
    const { findings } = await checkSkills(dir, { fix: true });
    expect(findings.map((f) => f.pruefung)).toContain("link");
    expect(await readFile(join(dir, ".claude/skills/demo/SKILL.md"), "utf8")).toBe(before);
  });

  it("eindeutiger npm-run-Rename wird gefixt, mehrdeutiger nicht", async () => {
    await w("package.json", JSON.stringify({ scripts: { "check:alpha": "x", "check:beta": "x" } }, null, 2));
    await skill("eins", "x".repeat(100), "npm run check:alpha\n");
    await skill("zwei", "x".repeat(100), "npm run check:beta\n");
    await readme("eins", "zwei");
    git("add", "-A"); git("commit", "-qm", "init");
    // Eindeutig: genau ein Commit entfernt check:alpha (Zeile 1, positionsstabil)
    // und legt genau einen neuen Key an.
    await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { "check:neu": "x", "check:beta": "x" } }, null, 2));
    git("add", "-A"); git("commit", "-qm", "rename-eindeutig");
    // Mehrdeutig: der eine Commit zu check:beta entfernt sie und legt zwei neue Keys an.
    await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { "check:neu": "x", "check:x1": "x", "check:x2": "x" } }, null, 2));
    git("add", "-A"); git("commit", "-qm", "rename-mehrdeutig");
    const { findings } = await checkSkills(dir, { fix: true });
    expect(findings).toContainEqual({ skill: "(fix)", pruefung: "fixed", detail: "npm run check:alpha → npm run check:neu" });
    expect(findings).toContainEqual({ skill: "zwei", pruefung: "npm-run", detail: "check:beta" });
    expect(await readFile(join(dir, ".claude/skills/eins/SKILL.md"), "utf8")).toContain("npm run check:neu");
    expect(await readFile(join(dir, ".claude/skills/zwei/SKILL.md"), "utf8")).toContain("npm run check:beta");
  });
});
