import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { join, sep } from "node:path";

/**
 * T1.5-4: project auto-discovery. A "project" is any immediate
 * subdirectory (depth 1, no recursion) of a configured `projectRoots`
 * entry that contains a `.git` (dir for a normal clone, file for a git
 * worktree — `stat` doesn't care which).
 */
export interface DiscoveredProject {
  /** Absolute path — this is exactly what SessionSpec.project expects, no
   * separate opaque id/lookup layer (unlike ADR-0001's swarm
   * allowlist_key, which solves a different transport's problem). */
  path: string;
  name: string;
  /** Best-effort from .git/HEAD; null for a detached HEAD or unreadable .git. */
  branch: string | null;
}

export interface ProjectDiscoveryResult {
  projects: DiscoveredProject[];
  /** One entry per root that doesn't exist or isn't readable — never a
   * silent empty result (BUG-0009's lesson: a misconfigured path fails
   * loud, not quiet). */
  warnings: string[];
}

async function readBranch(projectPath: string): Promise<string | null> {
  try {
    const head = await readFile(join(projectPath, ".git", "HEAD"), "utf8");
    const match = head.trim().match(/^ref:\s*refs\/heads\/(.+)$/);
    return match ? match[1]! : null;
  } catch {
    return null;
  }
}

export async function discoverProjects(roots: readonly string[]): Promise<ProjectDiscoveryResult> {
  const projects: DiscoveredProject[] = [];
  const warnings: string[] = [];

  for (const root of roots) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (err) {
      warnings.push(`projectRoots entry "${root}" is not readable: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = join(root, entry.name);
      try {
        await stat(join(full, ".git"));
      } catch {
        continue; // no .git -> not a project, depth 1 only, no recursion
      }
      projects.push({ path: full, name: entry.name, branch: await readBranch(full) });
    }
  }
  return { projects, warnings };
}

/**
 * T1.5-4 (security, not optional — AC-P1.5-5): when projectRoots is
 * configured, a session's project path must resolve inside one of them.
 * Resolves symlinks on both sides (ADR-0001's allowlist pattern: never
 * trust a client-supplied path at face value) so a symlink inside an
 * allowed root pointing outside it is rejected, not silently followed.
 * An empty `roots` list means unconfigured — preserves pre-T1.5-4
 * behavior (any path allowed) so existing configs don't break.
 */
export async function isProjectPathAllowed(projectPath: string, roots: readonly string[]): Promise<boolean> {
  if (roots.length === 0) return true;
  let real: string;
  try {
    real = await realpath(projectPath);
  } catch {
    return false;
  }
  for (const root of roots) {
    let realRoot: string;
    try {
      realRoot = await realpath(root);
    } catch {
      continue;
    }
    if (real === realRoot || real.startsWith(realRoot + sep)) return true;
  }
  return false;
}
