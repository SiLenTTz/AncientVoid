import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getSessionDiff } from "../src/diff.ts";

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
      expect(result.files).toEqual([{ path: "a.txt", additions: 2, deletions: 1, binary: false }]);
      expect(result.patch).toContain("-line2");
      expect(result.patch).toContain("+changed");
      expect(result.truncated).toBe(false);
      expect(result.error).toBeUndefined();
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
      expect(result.files).toEqual([{ path: "b.txt", additions: 1, deletions: 0, binary: false }]);
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
});
