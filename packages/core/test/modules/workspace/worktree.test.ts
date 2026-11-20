import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { WorktreeManager } from "../../../src/modules/workspace/worktree.ts";

const execFileAsync = promisify(execFile);

async function initRealRepo(dir: string): Promise<string> {
  await execFileAsync("git", ["-C", dir, "init", "-q", "-b", "main"]);
  await execFileAsync("git", ["-C", dir, "config", "user.email", "test@ancientvoid.local"]);
  await execFileAsync("git", ["-C", dir, "config", "user.name", "ancientvoid test"]);
  await writeFile(join(dir, "a.txt"), "hello\n");
  await execFileAsync("git", ["-C", dir, "add", "a.txt"]);
  await execFileAsync("git", ["-C", dir, "commit", "-q", "-m", "initial"]);
  const { stdout } = await execFileAsync("git", ["-C", dir, "rev-parse", "HEAD"]);
  return stdout.trim();
}

describe("WorktreeManager — against a real git repo, not a mock", () => {
  let repoDir: string;
  let nonGitDir: string;
  let worktreesDir: string;
  let realHeadSha: string;

  beforeAll(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "ancientvoid-wt-repo-"));
    nonGitDir = await mkdtemp(join(tmpdir(), "ancientvoid-wt-nongit-"));
    worktreesDir = await mkdtemp(join(tmpdir(), "ancientvoid-wt-out-"));
    realHeadSha = await initRealRepo(repoDir);
  });

  afterAll(async () => {
    await rm(repoDir, { recursive: true, force: true });
    await rm(nonGitDir, { recursive: true, force: true });
    await rm(worktreesDir, { recursive: true, force: true });
  });

  it("isGitRepo: true for a real repo, false for a plain directory", async () => {
    const wt = new WorktreeManager(worktreesDir);
    expect(await wt.isGitRepo(repoDir)).toBe(true);
    expect(await wt.isGitRepo(nonGitDir)).toBe(false);
  });

  it("create(): checks out a real worktree at the real HEAD sha, with the repo's actual files present", async () => {
    const wt = new WorktreeManager(worktreesDir);
    const result = await wt.create("session-real-1", repoDir);
    expect(result).not.toBeNull();
    expect(result!.baseSha).toBe(realHeadSha);
    expect(existsSync(result!.path)).toBe(true);
    const content = await readFile(join(result!.path, "a.txt"), "utf8");
    expect(content).toBe("hello\n");

    // real git state: worktree is on its own branch, main repo untouched
    const { stdout: branch } = await execFileAsync("git", ["-C", result!.path, "branch", "--show-current"]);
    expect(branch.trim()).toBe("ancientvoid/session-real-1");
    const { stdout: mainBranch } = await execFileAsync("git", ["-C", repoDir, "branch", "--show-current"]);
    expect(mainBranch.trim()).toBe("main");

    await wt.remove("session-real-1", repoDir);
  });

  it("create(): returns null for a non-git project — the documented, honest non-isolation fallback", async () => {
    const wt = new WorktreeManager(worktreesDir);
    const result = await wt.create("session-nongit", nonGitDir);
    expect(result).toBeNull();
  });

  it("remove(): really deletes the worktree directory and its branch", async () => {
    const wt = new WorktreeManager(worktreesDir);
    const result = await wt.create("session-real-2", repoDir);
    expect(existsSync(result!.path)).toBe(true);

    await wt.remove("session-real-2", repoDir);
    expect(existsSync(result!.path)).toBe(false);
    const { stdout: branches } = await execFileAsync("git", ["-C", repoDir, "branch", "--list", "ancientvoid/session-real-2"]);
    expect(branches.trim()).toBe("");
  });

  it("a commit made inside the worktree never touches the main repo's working tree", async () => {
    const wt = new WorktreeManager(worktreesDir);
    const result = await wt.create("session-real-3", repoDir);
    await writeFile(join(result!.path, "b.txt"), "from agent\n");
    await execFileAsync("git", ["-C", result!.path, "add", "b.txt"]);
    await execFileAsync("git", ["-C", result!.path, "commit", "-q", "-m", "agent change"]);

    expect(existsSync(join(repoDir, "b.txt"))).toBe(false);
    const { stdout: mainLog } = await execFileAsync("git", ["-C", repoDir, "log", "--oneline", "main"]);
    expect(mainLog.trim().split("\n")).toHaveLength(1); // still just "initial"

    await wt.remove("session-real-3", repoDir);
  });

  it("diskUsageBytes: reports a real, positive byte count for a checked-out worktree", async () => {
    const wt = new WorktreeManager(worktreesDir);
    const result = await wt.create("session-real-4", repoDir);
    const bytes = await wt.diskUsageBytes(result!.path);
    expect(bytes).toBeGreaterThan(0);
    expect(await wt.exceedsQuota(result!.path, 0)).toBe(true);
    expect(await wt.exceedsQuota(result!.path, Number.MAX_SAFE_INTEGER)).toBe(false);
    await wt.remove("session-real-4", repoDir);
  });

  it("reapOrphans: removes worktrees whose session id is no longer live", async () => {
    const wt = new WorktreeManager(worktreesDir);
    const orphan = await wt.create("session-orphan", repoDir);
    const alive = await wt.create("session-alive", repoDir);

    const removed = await wt.reapOrphans(repoDir, new Set(["session-alive"]));

    expect(removed).toEqual([orphan!.path]);
    expect(existsSync(orphan!.path)).toBe(false);
    expect(existsSync(alive!.path)).toBe(true);

    await wt.remove("session-alive", repoDir);
  });

  it("BUG-0246: remove löscht den Worktree auch wenn das Projekt kein Git-Repo mehr ist", async () => {
    const wt = new WorktreeManager(worktreesDir);
    const created = await wt.create("session-dead-project", repoDir);
    expect(created).not.toBeNull();
    expect(existsSync(created!.path)).toBe(true);
    // Projekt verliert sein .git (umbenannt/gelöscht) — früher: git worktree remove → 409.
    await rm(join(repoDir, ".git"), { recursive: true, force: true });
    await wt.remove("session-dead-project", repoDir);
    expect(existsSync(created!.path)).toBe(false);
    // Repo für nachfolgende Tests wiederherstellen.
    realHeadSha = await initRealRepo(repoDir);
  });

  it("BUG-0246: remove räumt auf wenn der Projektpfad fehlt", async () => {
    const wt = new WorktreeManager(worktreesDir);
    const created = await wt.create("session-missing-project", repoDir);
    expect(existsSync(created!.path)).toBe(true);
    await wt.remove("session-missing-project", join(tmpdir(), "ancientvoid-does-not-exist-" + Date.now()));
    expect(existsSync(created!.path)).toBe(false);
  });
});
