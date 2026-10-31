import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Real, verified (Linux, this machine, 2026-09-19/20): Claude Code (CLI
 * 2.1.263) keeps every session — interactive `claude`, `claude -p`, and the
 * hub's own `adapter-claude`-spawned turns alike — as one `.jsonl`
 * transcript per session under `~/.claude/projects/<sanitized-cwd>/`, where
 * `<sanitized-cwd>` is the session's real working directory with every `/`
 * replaced by `-`. Confirmed against this exact repo (directory
 * `-mnt-omarchy-data-30-repos-arch-arbeitsbaeume-AncientVoid`) and against
 * two of the hub's own T2.1 worktree sessions, which got their own
 * subpath-keyed directories automatically — same mechanism, no
 * hub-specific plumbing.
 *
 * NOTE — the encoding is real but one-way and ambiguous: a literal `-` that
 * is already part of a path segment (this repo's own "AncientVoid") is
 * indistinguishable in the directory name from a converted `/`. That is
 * fine for this adapter's actual job — computing the directory name FROM a
 * known real cwd is fully deterministic — but the reverse (directory name
 * -> cwd) is not attempted anywhere here and must never be.
 *
 * macOS/Windows have not been verified live (no such machine available
 * here) — Claude Code's own docs describe the same `~/.claude` layout on
 * all three platforms, so `defaultClaudeDir()` follows that, but only the
 * Linux path is real-verified.
 */
export function defaultClaudeDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return join(home, ".claude");
}

export function sanitizeCwdToProjectDirName(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

export function findProjectDir(claudeDir: string, projectPath: string): string | undefined {
  const dir = join(claudeDir, "projects", sanitizeCwdToProjectDirName(projectPath));
  return existsSync(dir) ? dir : undefined;
}

/** Top-level `*.jsonl` files only — real project directories also contain
 * a `memory/` subdirectory and per-session subdirectories (sidechain/agent
 * data), neither of which is a session transcript itself. */
function listSessionFiles(projectDir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(projectDir);
  } catch {
    return [];
  }
  return entries.filter((name) => name.endsWith(".jsonl") && statSync(join(projectDir, name)).isFile());
}

/** Most recently modified session transcript — "the session you were just
 * in", not necessarily the most recently *created* one (a resumed session's
 * file keeps its original name but grows in place). */
export function findMostRecentSessionFile(projectDir: string): string | undefined {
  const files = listSessionFiles(projectDir);
  if (files.length === 0) return undefined;
  let best: { name: string; mtimeMs: number } | undefined;
  for (const name of files) {
    const mtimeMs = statSync(join(projectDir, name)).mtimeMs;
    if (!best || mtimeMs > best.mtimeMs) best = { name, mtimeMs };
  }
  return best ? join(projectDir, best.name) : undefined;
}

export function findSessionFileById(projectDir: string, sessionId: string): string | undefined {
  const path = join(projectDir, `${sessionId}.jsonl`);
  return existsSync(path) ? path : undefined;
}
