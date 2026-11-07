import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { outsideRoots } from "./text.ts";

/**
 * EPIC-P34 T34.7: wo eine Session wirklich hingehört. Das Arbeitsverzeichnis (`cwd`) aus dem Transkript ist die
 * Quelle der Wahrheit, der gemungte Ordnername nur Rückfall. Reine Pfadlogik; nur der git-Worktree-Fall liest
 * eine kleine Datei und ist dafür austauschbar.
 */
export interface ProjectOrigin {
  /** Hauptprojekt; bei einem Worktree dessen Hauptverzeichnis. */
  project: string;
  /** Name des Worktrees, wenn die Session in einem lief. */
  worktree: string | null;
  /** /tmp und Fabrik-Kopien: werden in der UI eingeklappt, nie gelöscht. */
  temporary: boolean;
}

export type GitFileReader = (dir: string) => string | null;

/** `<haupt>/data/worktrees/<id>` (Agenten-Worktrees dieses Projekts) und `<haupt>/.claude/worktrees/<id>` (Claude Code). */
const WORKTREE_DIR = /^(.+?)\/(?:data|\.claude)\/worktrees\/([^/]+)(?:\/.*)?$/;
/** Ein git-Worktree hat statt `.git/` eine Datei `.git` mit `gitdir: <haupt>/.git/worktrees/<name>`. */
const GITDIR = /^gitdir:\s*(.+?)\/\.git\/worktrees\/([^/\s]+)\s*$/;

const defaultReadGitFile: GitFileReader = (dir) => {
  try {
    return readFileSync(join(dir, ".git"), "utf8");
  } catch {
    return null; // Verzeichnis weg, oder .git ist ein Ordner (normales Repo)
  }
};

const gitCache = new Map<string, { main: string; name: string } | null>();

function isTemporary(path: string): boolean {
  const tmp = tmpdir().replace(/\/$/, "");
  return /^\/(?:var\/)?tmp(?:\/|$)/.test(path) || path === tmp || path.startsWith(`${tmp}/`) || path.split("/").some((seg) => seg.startsWith("harnez-exec-"));
}

export function classifyProject(cwd: string, readGitFile: GitFileReader = defaultReadGitFile): ProjectOrigin {
  const path = cwd.length > 1 ? cwd.replace(/\/+$/, "") : cwd;
  const byPath = WORKTREE_DIR.exec(path);
  if (byPath) return { project: byPath[1]!, worktree: byPath[2]!, temporary: isTemporary(path) };
  let git = readGitFile === defaultReadGitFile ? gitCache.get(path) : undefined;
  if (git === undefined) {
    const match = GITDIR.exec(readGitFile(path)?.trim() ?? "");
    git = match ? { main: match[1]!, name: match[2]! } : null;
    if (readGitFile === defaultReadGitFile) {
      if (gitCache.size > 2000) gitCache.clear();
      gitCache.set(path, git);
    }
  }
  if (git) return { project: git.main, worktree: git.name, temporary: isTemporary(git.main) || isTemporary(path) };
  return { project: path, worktree: null, temporary: isTemporary(path) };
}

/**
 * Ein Pfad unter einer konfigurierten Projektwurzel ist Arbeit des Nutzers, auch wenn die Wurzel selbst unter /tmp liegt:
 * die Wurzel hebt die Orts-Regel auf. Fabrik-Kopien (`harnez-exec-*`) bleiben Rauschen. Ein nicht zurückgeführter
 * Ordnername wird über sein gemungtes Wurzel-Präfix zugeordnet (wie der Wurzel-Filter in `claudeDiscoverySource`).
 */
export function clearTemporaryUnderRoots(items: { project: string; temporary?: boolean }[], roots: readonly string[]): void {
  for (const item of items) {
    if (!item.temporary) continue;
    const own = roots.some((root) => {
      const abs = resolve(root);
      if (!outsideRoots(item.project, [abs])) return !item.project.slice(abs.length).split("/").some((seg) => seg.startsWith("harnez-exec-"));
      const munged = abs.replace(/[^a-zA-Z0-9]/g, "-");
      return item.project.startsWith("-") && (item.project === munged || item.project.startsWith(`${munged}-`));
    });
    if (own) item.temporary = false;
  }
}
