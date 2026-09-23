import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getSessionDiff, getSessionFileHunks } from "../../../src/modules/sessions/diff.ts";

const execFileAsync = promisify(execFile);

async function initRepo(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "uacc-diff-"));
  await execFileAsync("git", ["init", "-q", dir]);
  await execFileAsync("git", ["-C", dir, "config", "user.email", "test@example.com"]);
  await execFileAsync("git", ["-C", dir, "config", "user.name", "Test"]);
  await writeFile(join(dir, "a.txt"), "line1\nline2\n");
  await execFileAsync("git", ["-C", dir, "add", "a.txt"]);
  await execFileAsync("git", ["-C", dir, "commit", "-q", "-m", "init"]);
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

describe("getSessionDiff — real git repo, no mocking", () => {
  it("reports no changes as a named error, not an empty success", async () => {
    const { dir, cleanup } = await initRepo();
    try {
      const result = await getSessionDiff(dir);
      expect(result.files).toEqual([]);
      expect(result.patch).toBe("");
      expect(result.error).toMatch(/keine Änderungen/);
    } finally {
      await cleanup();
    }
  });

  it("reports real additions/deletions and a real patch for an uncommitted edit", async () => {
    const { dir, cleanup } = await initRepo();
    try {
      await writeFile(join(dir, "a.txt"), "line1\nchanged\nline3\n");
      const result = await getSessionDiff(dir);
      expect(result.files).toMatchObject([{ path: "a.txt", additions: 2, deletions: 1, binary: false }]);
      expect(result.files[0]!.hunks).toHaveLength(1);
      expect(result.files[0]!.hunks[0]!.body).toContain("-line2");
      expect(result.files[0]!.hunks[0]!.body).toContain("+changed");
      expect(result.patch).toContain("-line2");
      expect(result.patch).toContain("+changed");
      expect(result.truncated).toBe(false);
      expect(result.baseRef).toBe("HEAD");
      expect(result.error).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it("BUG-0020: reports a new file the agent never staged", async () => {
    const { dir, cleanup } = await initRepo();
    try {
      await execFileAsync("git", ["-C", dir, "config", "diff.mnemonicPrefix", "true"]);
      await writeFile(join(dir, ".gitignore"), "ignored.log\n");
      await execFileAsync("git", ["-C", dir, "add", ".gitignore"]);
      await execFileAsync("git", ["-C", dir, "commit", "-q", "-m", "ignore"]);
      await writeFile(join(dir, "a.txt"), "line1\nchanged\n");
      await writeFile(join(dir, "neu.txt"), "eins\nzwei\n");
      await writeFile(join(dir, "ignored.log"), "noise\n");
      const result = await getSessionDiff(dir);
      expect(result.error).toBeUndefined();
      expect(result.files.map((f) => f.path)).toEqual(["a.txt", "neu.txt"]);
      expect(result.files[1]).toMatchObject({ additions: 2, deletions: 0, binary: false });
      expect(result.files[1]!.hunks[0]!.body).toContain("+zwei");
      expect(result.files[0]!.hunks[0]!.body).toContain("+changed");
      const hunks = await getSessionFileHunks(dir, "neu.txt");
      expect(hunks[0]?.body).toContain("+eins");
    } finally {
      await cleanup();
    }
  });

  it("reports a new untracked-but-added file", async () => {
    const { dir, cleanup } = await initRepo();
    try {
      await writeFile(join(dir, "b.txt"), "new file\n");
      await execFileAsync("git", ["-C", dir, "add", "b.txt"]);
      const result = await getSessionDiff(dir);
      expect(result.files).toMatchObject([{ path: "b.txt", additions: 1, deletions: 0, binary: false }]);
    } finally {
      await cleanup();
    }
  });

  it("names the failure for a non-git directory instead of throwing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uacc-diff-nongit-"));
    try {
      const result = await getSessionDiff(dir);
      expect(result.files).toEqual([]);
      expect(result.error).toMatch(/git diff fehlgeschlagen/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T2.2: diffs against a real base_sha (a worktree's actual base), not just HEAD — sees a committed change too", async () => {
    const { dir, cleanup } = await initRepo();
    try {
      const { stdout: baseSha } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: dir });
      // Commit a real change on top of base — `git diff HEAD` would show
      // nothing (working tree matches the new HEAD); diffing against the
      // real base_sha must still show it, exactly as T2.1's worktree base
      // requires.
      await writeFile(join(dir, "a.txt"), "line1\ncommitted change\n");
      await execFileAsync("git", ["-C", dir, "commit", "-aqm", "second"]);

      const againstHead = await getSessionDiff(dir);
      expect(againstHead.error).toMatch(/keine Änderungen/);

      const againstBase = await getSessionDiff(dir, baseSha.trim());
      expect(againstBase.baseRef).toBe(baseSha.trim());
      expect(againstBase.files).toMatchObject([{ path: "a.txt" }]);
      expect(againstBase.patch).toContain("+committed change");
    } finally {
      await cleanup();
    }
  });

  it("T2.2: extracts git's own real function-context as the hunk's function anchor", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uacc-diff-fn-"));
    try {
      await execFileAsync("git", ["init", "-q", dir]);
      await execFileAsync("git", ["-C", dir, "config", "user.email", "t@e.com"]);
      await execFileAsync("git", ["-C", dir, "config", "user.name", "T"]);
      // Enough lines between the def and the changed line that git's
      // default 3-line hunk context doesn't reach back past
      // "def target_function():" into the preceding function — otherwise
      // git's own heuristic (correctly) reports the nearer preceding def
      // instead (real behavior, confirmed by hand against real git before
      // fixing this test).
      const before = [
        "def existing():",
        "    pass",
        "",
        "def target_function():",
        "    a = 1",
        "    b = 2",
        "    c = 3",
        "    return a + b + c",
        "",
      ].join("\n");
      await writeFile(join(dir, "m.py"), before);
      await execFileAsync("git", ["-C", dir, "add", "m.py"]);
      await execFileAsync("git", ["-C", dir, "commit", "-q", "-m", "init"]);
      const after = before.replace("return a + b + c", "return a + b + c + 1");
      await writeFile(join(dir, "m.py"), after);

      const result = await getSessionDiff(dir);
      const hunk = result.files[0]!.hunks[0]!;
      // Real git built-in Python funcname heuristic — not hand-rolled here.
      expect(hunk.functionContext).toBe("def target_function():");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T2.2 (K3): a diff over the 50 KB threshold collapses hunk bodies to a preview; expand-on-tap fetches the full hunk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uacc-diff-k3-"));
    try {
      await execFileAsync("git", ["init", "-q", dir]);
      await execFileAsync("git", ["-C", dir, "config", "user.email", "t@e.com"]);
      await execFileAsync("git", ["-C", dir, "config", "user.name", "T"]);
      const bigBefore = Array.from({ length: 4000 }, (_, i) => `line ${i}`).join("\n") + "\n";
      await writeFile(join(dir, "big.txt"), bigBefore);
      await execFileAsync("git", ["-C", dir, "add", "big.txt"]);
      await execFileAsync("git", ["-C", dir, "commit", "-q", "-m", "init"]);
      const bigAfter = Array.from({ length: 4000 }, (_, i) => `line ${i} changed`).join("\n") + "\n";
      await writeFile(join(dir, "big.txt"), bigAfter);

      const result = await getSessionDiff(dir);
      expect(result.truncated).toBe(true);
      const hunk = result.files[0]!.hunks[0]!;
      expect(hunk.collapsed).toBe(true);
      expect(hunk.body.split("\n").length).toBeLessThanOrEqual(3);

      const full = await getSessionFileHunks(dir, "big.txt");
      expect(full[0]!.collapsed).toBe(false);
      expect(full[0]!.body.split("\n").length).toBeGreaterThan(3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T2.9 (K3 gate, AC-P2-2): a real 2 MB diff keeps the initial response ≤ 50 KB; expand-on-tap still delivers the rest correctly", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uacc-diff-k3-gate-"));
    try {
      await execFileAsync("git", ["init", "-q", dir]);
      await execFileAsync("git", ["-C", dir, "config", "user.email", "t@e.com"]);
      await execFileAsync("git", ["-C", dir, "config", "user.name", "T"]);
      // A real ~2 MB changeset across several files — not one contrived
      // giant hunk, so this also exercises collapsing across multiple
      // files/hunks at once, not just a single one.
      const lineCount = 15_000; // ~2 MB across 4 files at this line length
      for (let f = 0; f < 4; f++) {
        const before = Array.from({ length: lineCount }, (_, i) => `file${f} line ${i} original content padding`).join("\n") + "\n";
        await writeFile(join(dir, `f${f}.txt`), before);
      }
      await execFileAsync("git", ["-C", dir, "add", "."]);
      await execFileAsync("git", ["-C", dir, "commit", "-q", "-m", "init"]);
      let totalRawDiffBytes = 0;
      for (let f = 0; f < 4; f++) {
        const after = Array.from({ length: lineCount }, (_, i) => `file${f} line ${i} CHANGED content padding`).join("\n") + "\n";
        await writeFile(join(dir, `f${f}.txt`), after);
      }
      const { stdout: rawPatch } = await execFileAsync("git", ["-C", dir, "diff", "HEAD"], { maxBuffer: 16 * 1024 * 1024 });
      totalRawDiffBytes = Buffer.byteLength(rawPatch, "utf8");
      expect(totalRawDiffBytes).toBeGreaterThan(2 * 1024 * 1024); // confirms this really is a ~2 MB+ diff, not a guess

      const result = await getSessionDiff(dir);
      expect(result.truncated).toBe(true);
      expect(result.files).toHaveLength(4);
      for (const f of result.files) expect(f.hunks.every((h) => h.collapsed)).toBe(true);

      const responseBytes = Buffer.byteLength(JSON.stringify(result), "utf8");
      expect(responseBytes).toBeLessThanOrEqual(50_000); // AC-P2-2: initiale Payload ≤ 50 KB

      // Expand-on-tap still delivers the real full content afterward.
      const full = await getSessionFileHunks(dir, "f0.txt");
      expect(full.length).toBeGreaterThan(0);
      expect(full.every((h) => !h.collapsed)).toBe(true);
      expect(full[0]!.body).toContain("CHANGED");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
