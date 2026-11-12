import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { checkBudgets, checkLinks, checkReferences, checkDocKind, checkDrift, runAll, walk } from "./check-context.mjs";

// Kontext-Hygiene-Gate: Jede Regel findet ihr gepflanztes Fixture (verschwindet
// eine Regel, schlägt ihr positiver Fall), bekannte zulässige Fälle (datierte
// Snapshots, ADRs, Test-Beigesellung, repo-externe Links) lösen nichts aus.

let dir;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "check-context-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const w = async (rel, content) => {
  const p = join(dir, rel);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, content, "utf8");
};

describe("check-context — Zeilen-Budgets", () => {
  it("überschritten schlägt an, innerhalb nicht", async () => {
    await w("AGENTS.md", "x\n".repeat(201));
    await w(".claude/skills/demo/SKILL.md", "y\n".repeat(251));
    await w("CONTRIBUTING.md", "z\n".repeat(200));
    const findings = checkBudgets(dir, walk(dir, ".", []));
    expect(findings.map((f) => f.rule + " " + f.file)).toEqual([
      "budget AGENTS.md",
      "budget .claude/skills/demo/SKILL.md",
    ]);
  });
});

describe("check-context — Links", () => {
  it("toter Relativ-Link schlägt an; http/#/extern zulässig", async () => {
    await w("AGENTS.md", "[gut](CONTRIBUTING.md) [http](https://x.y/a) [anker](#top) [extern](../nachbar-repo/README.md) [tot](docs/fehlt.md)\n");
    await w("CONTRIBUTING.md", "# c\n");
    await w("docs/vorhanden.md", "# d\n");
    await w(".claude/skills/demo/SKILL.md", "[ok](../../../docs/vorhanden.md)\n");
    const findings = checkLinks(dir, walk(dir, ".", []));
    expect(findings).toEqual([{ rule: "link", file: "AGENTS.md", detail: "toter Link → docs/fehlt.md" }]);
  });
});

describe("check-context — Referenzen", () => {
  beforeEach(async () => {
    await w("README.md", "Siehe [erwähnt](docs/erwaehnt.md) und `scripts/laeuft.mjs`.\n");
    await w("package.json", "{}\n");
  });

  it("unreferenzierte docs/*.md schlägt an; Snapshots/ADR/messlauf/assets sind befreit", async () => {
    await w("docs/waise.md", "# w\n");
    await w("docs/2026-10-28_snapshot.md", "# s\n");
    await w("docs/bericht-2026-10-28.md", "# b\n");
    await w("docs/adr/0001-alte-entscheidung.md", "# a\n");
    await w("docs/erwaehnt.md", "# e\n");
    const findings = checkReferences(dir, walk(dir, ".", [])).filter((f) => f.rule === "docs-ref");
    expect(findings.map((f) => f.file)).toEqual(["docs/waise.md"]);
  });

  it("Script ohne Referenz und ohne Test schlägt an; Test oder Referenz erlöst", async () => {
    await w("scripts/waise.mjs", "export const x = 1;\n");
    await w("scripts/GETESTET.mjs", "export const y = 1;\n");
    await w("scripts/GETESTET.test.mjs", "import { y } from './GETESTET.mjs'\n");
    await w("scripts/laeuft.mjs", "export const z = 1;\n"); // in README referenziert
    const findings = checkReferences(dir, walk(dir, ".", [])).filter((f) => f.rule === "script-ref");
    expect(findings.map((f) => f.file)).toEqual(["scripts/waise.mjs"]);
  });
});

describe("check-context — Doku-Arten (Diátaxis)", () => {
  it("fehlende, doppelte, unbekannte Art und fehlender Index-Eintrag schlagen an; Snapshots/ADR befreit", async () => {
    await w("docs/uebersicht.md", "# Übersicht\n\n**Art:** referenz\n\ngut.md ohne.md doppelt.md falsch.md\n");
    await w("docs/gut.md", "# a\n\n**Art:** how-to\n");
    await w("docs/ohne.md", "# b\n");
    await w("docs/doppelt.md", "# c\n**Art:** how-to\n**Art:** referenz\n");
    await w("docs/falsch.md", "# d\n**Art:** blog\n");
    await w("docs/nicht-gelistet.md", "# e\n**Art:** erklaerung\n");
    await w("docs/2026-11-13_snapshot.md", "# f\n");
    await w("docs/adr/0001-x.md", "# g\n");
    const findings = checkDocKind(dir, walk(dir, ".", []));
    expect(findings.map((f) => `${f.rule} ${f.file}`)).toEqual([
      "doc-kind docs/doppelt.md",
      "doc-kind docs/falsch.md",
      "doc-index docs/nicht-gelistet.md",
      "doc-kind docs/ohne.md",
    ]);
  });
  it("ohne Übersichtsseite schlägt doc-index an", async () => {
    await w("docs/gut.md", "# a\n\n**Art:** how-to\n");
    expect(checkDocKind(dir, walk(dir, ".", [])).map((f) => f.rule)).toEqual(["doc-index"]);
  });
});

describe("check-context — Frischhalte-Drift", () => {
  const map = [{ doc: "docs/lebend.md", areas: ["packages/core/"], maxDrift: 150 }];

  it("Drift über Limit schlägt an, darunter nicht", async () => {
    await w("docs/lebend.md", "# l\n");
    const git = { lastCommitIso: () => "2026-01-01T00:00:00+00:00", isDirty: () => false, countSince: () => 151 };
    expect(checkDrift(dir, git, map)).toHaveLength(1);
    git.countSince = () => 150;
    expect(checkDrift(dir, git, map)).toEqual([]);
  });

  it("uncommittete Überarbeitung gilt als laufendes Review", async () => {
    await w("docs/lebend.md", "# l\n");
    const git = { lastCommitIso: () => "2026-01-01T00:00:00+00:00", isDirty: () => true, countSince: () => 999 };
    expect(checkDrift(dir, git, map)).toEqual([]);
  });

  it("Map-Eintrag ohne Datei fordert Map-Pflege", async () => {
    const git = { lastCommitIso: () => null, isDirty: () => false, countSince: () => 0 };
    const findings = checkDrift(dir, git, [{ doc: "docs/fehlt.md", areas: ["x/"], maxDrift: 10 }]);
    expect(findings[0].rule).toBe("drift-map");
  });
});

describe("check-context — runAll gegen echtes Repo", () => {
  it("Repo besteht seinen eigenen Gate-Stand (sanity: alle Regeln laufen, null Befunde)", async () => {
    const { fileURLToPath } = await import("node:url");
    const { dirname, resolve } = await import("node:path");
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const result = runAll(root);
    expect(result.checked).toBeGreaterThan(1000);
    expect(result.findings).toEqual([]);
  });
});
