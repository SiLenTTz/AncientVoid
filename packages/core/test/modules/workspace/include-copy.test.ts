import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyIncludedFiles } from "../../../src/modules/workspace/include-copy.ts";

const execFileAsync = promisify(execFile);

const SECRET_VALUE = "hase-iftar-bingo-42";

/** Repo mit Trackted a.txt, Ignore-Regeln und echtem Worktree an HEAD. */
async function fixture(tag: string): Promise<{ repo: string; worktree: string; out: string }> {
  const repo = await mkdtemp(join(tmpdir(), `ancientvoid-p29cpy-${tag}-`));
  const out = await mkdtemp(join(tmpdir(), `ancientvoid-p29cpy-${tag}-out-`));
  const git = (...args: string[]) => execFileAsync("git", ["-C", repo, ...args]);
  await git("init", "-q", "-b", "main");
  await git("config", "user.email", "t@ancientvoid.local");
  await git("config", "user.name", "ancientvoid test");
  await writeFile(join(repo, "a.txt"), "tracked\n");
  // tracked UND gemustert ignoriert — testspezifisch für den Zielkonflikt;
  // `git add -A` würde die ignorierte Datei überspringen, deshalb forciert:
  await mkdir(join(repo, "config"), { recursive: true });
  await writeFile(join(repo, "config", "tracked-ignored.json"), "{}\n");
  await writeFile(
    join(repo, ".gitignore"),
    ".env\nconfig/local.json\nconfig/tracked-ignored.json\nleak.env\nplain-env/\netcdir/\n",
  );
  await git("add", "-A");
  await git("add", "-f", "config/tracked-ignored.json");
  await git("commit", "-q", "-m", "initial");
  const worktree = join(out, "wt");
  await git("worktree", "add", "--detach", worktree, "HEAD");
  return { repo, worktree, out };
}

describe("EPIC-P29 T29.2: sichere Dateiübernahme (ADR-0051 §2)", () => {
  it("übernimmt nur gitignorierte lokale Dateien und berichtet Pfade/Bytes statt Inhalte", async () => {
    const { repo, worktree, out } = await fixture("ok");
    try {
      await mkdir(join(repo, "config"), { recursive: true });
      await writeFile(join(repo, ".env"), `SECRET=${SECRET_VALUE}\n`);
      await writeFile(join(repo, "config", "local.json"), '{"log":"debug"}\n');
      const report = await copyIncludedFiles(repo, worktree, [".env", "config/local.json"]);
      expect(report.rejected).toEqual([]);
      expect(report.copied.map((c) => c.path).sort()).toEqual([".env", "config/local.json"]);
      expect(await readFile(join(worktree, ".env"), "utf8")).toBe(`SECRET=${SECRET_VALUE}\n`);
      // K5/PRD §8.5: Bericht und Gründe führen nie Inhalte
      expect(JSON.stringify(report)).not.toContain(SECRET_VALUE);
    } finally {
      await rm(repo, { recursive: true, force: true });
      await rm(out, { recursive: true, force: true });
    }
  });

  it("lehnt Symlinks ab — auch als Flucht nach außerhalb des Projekts", async () => {
    const { repo, worktree, out } = await fixture("sym");
    try {
      await symlink("/etc/passwd", join(repo, "leak.env"));
      await symlink("/etc", join(repo, "etcdir"));
      const report = await copyIncludedFiles(repo, worktree, ["leak.env", "etcdir/passwd"]);
      expect(report.copied).toEqual([]);
      expect(report.rejected.find((r) => r.path === "leak.env")?.reason).toContain("Symlinks");
      expect(report.rejected.find((r) => r.path === "etcdir/passwd")?.reason).toContain("Quellprojekt");
      expect(existsSync(join(worktree, "leak.env"))).toBe(false);
    } finally {
      await rm(repo, { recursive: true, force: true });
      await rm(out, { recursive: true, force: true });
    }
  });

  it("lehnt Traversal, .git/ und data/ ab — auch bei direktem Aufruf ohne Schema", async () => {
    const { repo, worktree, out } = await fixture("trav");
    try {
      const report = await copyIncludedFiles(repo, worktree, ["../a.txt", ".git/config", "data/hub.sqlite"]);
      expect(report.copied).toEqual([]);
      expect(report.rejected).toHaveLength(3);
      for (const r of report.rejected) expect(r.reason).toContain("Vertrag");
    } finally {
      await rm(repo, { recursive: true, force: true });
      await rm(out, { recursive: true, force: true });
    }
  });

  it("lehnt nicht gitignorierte Dateien ab (Übernahme ist opt-in)", async () => {
    const { repo, worktree, out } = await fixture("notign");
    try {
      await writeFile(join(repo, "untracked-plain.txt"), "x\n");
      const report = await copyIncludedFiles(repo, worktree, ["untracked-plain.txt", "a.txt"]);
      expect(report.copied).toEqual([]);
      // untracked ohne Ignore-Eintrag: kein lokales Übernahme-Kandidat;
      // getrackt (a.txt): würde eine verfolgte Worktree-Datei überschreiben
      expect(report.rejected.find((r) => r.path === "untracked-plain.txt")?.reason).toContain("nicht gitignoriert");
      expect(report.rejected.find((r) => r.path === "a.txt")?.reason).toContain("verfolgte Datei");
    } finally {
      await rm(repo, { recursive: true, force: true });
      await rm(out, { recursive: true, force: true });
    }
  });

  it("überschreibt nie eine verfolgte Datei im Worktree", async () => {
    const { repo, worktree, out } = await fixture("tracked");
    try {
      const report = await copyIncludedFiles(repo, worktree, ["config/tracked-ignored.json"]);
      expect(report.copied).toEqual([]);
      expect(report.rejected[0]?.reason).toContain("verfolgte Datei");
      expect(await readFile(join(worktree, "config", "tracked-ignored.json"), "utf8")).toBe("{}\n"); // unangetastet
    } finally {
      await rm(repo, { recursive: true, force: true });
      await rm(out, { recursive: true, force: true });
    }
  });

  it("erzwingt Anzahl-/Byte-Budget und bleibt dabei ehrlich (fehlende Datei, Budgetgrund)", async () => {
    const { repo, worktree, out } = await fixture("budget");
    try {
      await writeFile(join(repo, ".env"), `SECRET=${SECRET_VALUE}\n`);
      const report = await copyIncludedFiles(repo, worktree, [".env", "fehlt.env"], { maxFiles: 256, maxBytes: 4 });
      expect(report.copied).toEqual([]);
      expect(report.rejected.find((r) => r.path === ".env")?.reason).toContain("Budget");
      expect(report.rejected.find((r) => r.path === "fehlt.env")?.reason).toContain("fehlt");
      expect(JSON.stringify(report)).not.toContain(SECRET_VALUE);
    } finally {
      await rm(repo, { recursive: true, force: true });
      await rm(out, { recursive: true, force: true });
    }
  });
});
