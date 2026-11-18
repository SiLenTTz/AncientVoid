import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildReleaseNotes, buildReleaseNotesDetail, ReleaseNotesNotFoundError } from "../../../src/modules/release-notes/index.ts";
import { RELEASE_NOTES_BODY_CAP } from "@ancientvoid/contracts";

const exec = promisify(execFile);

/** EPIC-P68 (ADR-0089): Builder gegen echte Git-Repos — Merge-Commits als PRs,
 * Notation Subject/Body, Caps mit truncated, benannte Fehler (fail loud). */

let base: string;
let repo: string;
let initSha: string;

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec("git", ["-C", cwd, ...args]);
  return stdout;
}

async function commitFile(cwd: string, path: string, content: string, subject: string, body?: string): Promise<void> {
  await writeFile(join(cwd, path), content);
  await git(cwd, "add", ".");
  await git(cwd, "commit", "-q", "-m", subject, ...(body ? ["-m", body] : []));
}

async function mergePr(cwd: string, branch: string, subject: string, body: string): Promise<void> {
  await git(cwd, "checkout", "-q", "main");
  await git(cwd, "merge", "--no-ff", "-q", "-m", subject, "-m", body, branch);
}

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "av-rn-"));
  repo = join(base, "proj");
  await mkdir(repo, { recursive: true });
  await git(repo, "init", "-q", "-b", "main");
  await git(repo, "config", "user.email", "t@t.com");
  await git(repo, "config", "user.name", "T");
  await commitFile(repo, "README.md", "# hi\n", "init");
  initSha = (await git(repo, "rev-parse", "HEAD")).trim();

  // PR #1: zwei Branch-Commits mit Notation, Merge-Subject mit (#1) und PR-Body.
  await git(repo, "checkout", "-q", "-b", "feat/eins");
  await commitFile(repo, "a.ts", "export const a = 1;\n", "^ F core: erste Faehigkeit", "Warum: der Handy-Abfluss braucht sie.");
  await commitFile(repo, "b.ts", "test();\n", ". t core: tests fuer die faehigkeit", "Zwei Tests decken das Verhalten.");
  await mergePr(repo, "feat/eins", "^ F core: erste Faehigkeit buendeln (#1)", "PR-Beschreibung: bündelt T1 mit zwei Commits.");

  // PR #2: Subject OHNE Notation (real wie BUG-0211/PR #150) — muss roh bleiben.
  await git(repo, "checkout", "-q", "-b", "feat/zwei");
  await commitFile(repo, "c.ts", "fix();\n", "! B pwa: fehler beim laden repariert", "BUG-0001: Ladeanzeige blieb stehen.");
  await mergePr(repo, "feat/zwei", "BUG-0001: Chat laedt wieder (#2)", "Warum: Regression aus T0.");
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("buildReleaseNotes (T68.2, ADR-0089)", () => {
  it("listet PRs neueste zuerst, mit Notation bzw. roh (fail loud) und Stats", async () => {
    const report = await buildReleaseNotes(repo);
    expect(report.error).toBeUndefined();
    expect(report.truncated).toBe(false);
    expect(report.entries).toHaveLength(2);

    const newest = report.entries[0]!;
    expect(newest.notation.prNumber).toBe(2);
    expect(newest.notation.unparsed).toBe(true);
    expect(newest.notation.summary).toBe("BUG-0001: Chat laedt wieder (#2)");
    expect(newest.stats?.filesChanged).toBeGreaterThanOrEqual(1);
    expect(newest.stats?.insertions).toBeGreaterThanOrEqual(1);
    expect(newest.mergedAt).not.toBe("");

    const first = report.entries[1]!;
    expect(first.notation).toMatchObject({ risk: "^", intent: "F", area: "core", prNumber: 1, unparsed: false });
    expect(first.notation.summary).toBe("erste Faehigkeit buendeln");
    expect(first.stats?.filesChanged).toBe(2);
  });

  it("limit kürzt mit truncated-Flag statt still", async () => {
    const report = await buildReleaseNotes(repo, 1);
    expect(report.entries).toHaveLength(1);
    expect(report.truncated).toBe(true);
    expect(report.maxEntries).toBe(1);
  });

  it("kein Git-Repository → benannter Fehler, keine leere Erfolgsliste", async () => {
    const dir = await mkdtemp(join(tmpdir(), "av-rn-nogit-"));
    try {
      const report = await buildReleaseNotes(dir);
      expect(report.entries).toEqual([]);
      expect(report.error).toBe("Kein Git-Repository.");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("Verlauf ohne gemergte PRs → benannter Fehler (kein Still-Fallback)", async () => {
    const dir = join(base, "nomerge");
    await mkdir(dir);
    await git(dir, "init", "-q", "-b", "main");
    await git(dir, "config", "user.email", "t@t.com");
    await git(dir, "config", "user.name", "T");
    await commitFile(dir, "README.md", "# x\n", "solo");
    const report = await buildReleaseNotes(dir);
    expect(report.entries).toEqual([]);
    expect(report.error).toBe("Keine gemergten Pull-Requests im Verlauf.");
  });
});

describe("buildReleaseNotesDetail (T68.2, ADR-0089)", () => {
  it("liefert Warum (PR-Body) und Was (Commits mit Notation + Body, Dateien, Stats)", async () => {
    const list = await buildReleaseNotes(repo);
    const sha = list.entries[1]!.mergeSha; // PR #1
    const detail = await buildReleaseNotesDetail(repo, sha);

    expect(detail.mergeSha).toBe(sha);
    expect(detail.body).toContain("bündelt T1");
    expect(detail.bodyTruncated).toBe(false);
    expect(detail.commits.map((c) => c.notation.intent)).toEqual(["F", "t"]);
    expect(detail.commits[0]!.notation.area).toBe("core");
    expect(detail.commits[0]!.body).toContain("Warum");
    expect(detail.commits.map((c) => c.notation.summary)).toEqual(["erste Faehigkeit", "tests fuer die faehigkeit"]);
    expect(detail.files.map((f) => f.path).sort()).toEqual(["a.ts", "b.ts"]);
    expect(detail.stats?.filesChanged).toBe(2);
    expect(detail.filesTruncated).toBe(false);
    expect(detail.commitsTruncated).toBe(false);
  });

  it("unbekannter SHA → ReleaseNotesNotFoundError", async () => {
    await expect(buildReleaseNotesDetail(repo, "0".repeat(40))).rejects.toBeInstanceOf(ReleaseNotesNotFoundError);
  });

  it("SHA ohne Merge-Eltern (normaler Commit) → ReleaseNotesNotFoundError", async () => {
    await expect(buildReleaseNotesDetail(repo, initSha)).rejects.toBeInstanceOf(ReleaseNotesNotFoundError);
  });

  it("Caps: Commits, Dateien und Body werden ehrlich gekappt (truncated)", async () => {
    const dir = join(base, "caps");
    await mkdir(dir);
    await git(dir, "init", "-q", "-b", "main");
    await git(dir, "config", "user.email", "t@t.com");
    await git(dir, "config", "user.name", "T");
    await commitFile(dir, "README.md", "# c\n", "init");
    await git(dir, "checkout", "-q", "-b", "big");
    // 52 Commits → commitsTruncated; lange Body → bodyTruncated.
    for (let i = 0; i < 52; i++) {
      await git(dir, "commit", "-q", "--allow-empty", "-m", `. t core: schritt ${i}`, ...(i === 51 ? ["-m", "x".repeat(RELEASE_NOTES_BODY_CAP + 10)] : []));
    }
    // 61 Dateien in einem Commit → filesTruncated.
    for (let i = 0; i < 61; i++) await writeFile(join(dir, `f${i}.txt`), `${i}\n`);
    await git(dir, "add", ".");
    await git(dir, "commit", "-q", "-m", ". t core: viele dateien");
    await mergePr(dir, "big", "^ F core: grosser pr (#3)", "Warum auch immer.");

    const list = await buildReleaseNotes(dir);
    const detail = await buildReleaseNotesDetail(dir, list.entries[0]!.mergeSha);
    expect(detail.commits).toHaveLength(50);
    expect(detail.commitsTruncated).toBe(true);
    expect(detail.files).toHaveLength(60);
    expect(detail.filesTruncated).toBe(true);
    // Der Cap zeigt die neuesten 50 Commits (chronologisch); der überlange Body
    // hängt am neuesten Commit — deshalb dort angelegt.
    const longBody = detail.commits.find((c) => c.body.length === RELEASE_NOTES_BODY_CAP);
    expect(longBody?.bodyTruncated).toBe(true);
  });
});
