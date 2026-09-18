import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir } from "node:fs/promises";

const execFileAsync = promisify(execFile);

/**
 * T2.1: per-session git worktree isolation (EPIC-P2 §3 "Worktree-Manager").
 *
 * A session that works against a real git repo gets its own `git worktree`
 * checked out at the project's current HEAD — the agent's commits land on
 * an isolated branch, never on whatever the user has checked out in the
 * main working copy. Sessions whose `project` isn't a git repo (e.g. this
 * repo's own dummy-adapter tests using a bare temp dir) get no isolation —
 * `create()` returns null and the caller falls back to the raw project
 * path, exactly as before T2.1 existed. That fallback is a real, named
 * choice, not a silent gap: SessionManager surfaces it as a system event
 * (`session.no_worktree_isolation`) rather than pretending isolation
 * happened when it didn't (AGENTS.md Regel 6).
 *
 * "Disk-Quota pro Worktree" (EPIC-P2 §2 In) is implemented as a soft,
 * polled `du -sb` check (`diskUsageBytes` / `exceedsQuota`), not an OS-level
 * filesystem quota — this environment has no xfs/btrfs project-quota
 * support to enforce a hard cap without root, so a hard per-worktree quota
 * is honestly out of reach here; the soft check is what SessionManager
 * actually wires up (a `system` warning event, not an enforced kill).
 */
export class WorktreeManager {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  async isGitRepo(projectPath: string): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync("git", ["-C", projectPath, "rev-parse", "--is-inside-work-tree"]);
      return stdout.trim() === "true";
    } catch {
      return false;
    }
  }

  /** Real HEAD sha of the project repo, or null if it isn't a git repo. */
  async headSha(projectPath: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync("git", ["-C", projectPath, "rev-parse", "HEAD"]);
      return stdout.trim();
    } catch {
      return null;
    }
  }

  /** Deterministic path for a session's worktree — exposed so callers
   * (K7 recovery) can find an already-created worktree again without
   * re-running `git worktree add`. */
  pathFor(sessionId: string): string {
    return `${this.baseDir}/${sessionId}`;
  }

  private worktreePath(sessionId: string): string {
    return this.pathFor(sessionId);
  }

  private branchName(sessionId: string): string {
    return `uacc/${sessionId}`;
  }

  /**
   * Creates `<baseDir>/<sessionId>` as a new worktree of `projectPath` on a
   * fresh branch `uacc/<sessionId>`, pinned at the project's current HEAD.
   * Returns null (no throw) when `projectPath` isn't a git repo at all —
   * that is the documented, honest non-isolation fallback, not an error.
   */
  async create(sessionId: string, projectPath: string): Promise<{ path: string; baseSha: string } | null> {
    const baseSha = await this.headSha(projectPath);
    if (baseSha === null) return null;
    await mkdir(this.baseDir, { recursive: true });
    const path = this.worktreePath(sessionId);
    await execFileAsync("git", ["-C", projectPath, "worktree", "add", "-b", this.branchName(sessionId), path, baseSha]);
    return { path, baseSha };
  }

  /**
   * Removes the worktree and its branch. Best-effort on the branch delete
   * (a worktree can be removed even if the branch was already cleaned up
   * by something else) — but the worktree removal itself is not swallowed,
   * since a leftover worktree directory is exactly the disk-usage problem
   * this task exists to avoid.
   */
  async remove(sessionId: string, projectPath: string): Promise<void> {
    const path = this.worktreePath(sessionId);
    await execFileAsync("git", ["-C", projectPath, "worktree", "remove", "--force", path]);
    await execFileAsync("git", ["-C", projectPath, "branch", "-D", this.branchName(sessionId)]).catch(() => undefined);
  }

  /** Real `du -sb` in bytes — not an estimate, not a guess. */
  async diskUsageBytes(path: string): Promise<number> {
    const { stdout } = await execFileAsync("du", ["-sb", path]);
    const [bytes] = stdout.split("\t");
    return Number(bytes ?? 0);
  }

  /** Soft quota check (see class doc comment) — true means over budget. */
  async exceedsQuota(path: string, maxBytes: number): Promise<boolean> {
    return (await this.diskUsageBytes(path)) > maxBytes;
  }

  /**
   * K7-style hygiene: worktrees under baseDir whose session id isn't in
   * `liveSessionIds` are orphans (owning session died before cleanup ran,
   * e.g. a hard `kill -9` of the hub itself) — remove them and report what
   * was cleaned up.
   */
  async reapOrphans(projectPath: string, liveSessionIds: ReadonlySet<string>): Promise<string[]> {
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync("git", ["-C", projectPath, "worktree", "list", "--porcelain"]));
    } catch {
      return [];
    }
    const removed: string[] = [];
    for (const block of stdout.split("\n\n")) {
      const pathLine = block.split("\n").find((l) => l.startsWith("worktree "));
      if (!pathLine) continue;
      const wtPath = pathLine.slice("worktree ".length).trim();
      if (!wtPath.startsWith(this.baseDir)) continue;
      const sessionId = wtPath.slice(this.baseDir.length + 1);
      if (liveSessionIds.has(sessionId)) continue;
      try {
        await this.remove(sessionId, projectPath);
        removed.push(wtPath);
      } catch {
        // leave it — reapOrphans is best-effort hygiene, not a hard guarantee
      }
    }
    return removed;
  }
}
