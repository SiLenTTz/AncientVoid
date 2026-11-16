import { lstat, mkdir, readdir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { nearestExistingAncestor, pathStyle, pathWithin } from "../../platform/index.ts";

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
  /** BUG-0172: false = Ordner ohne `.git`. Er wird trotzdem angeboten, weil
   * lokales Arbeiten ohne Git kein Umweg über `git init` sein darf. */
  isGit: boolean;
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
      if (entry.name.startsWith(".")) continue;
      const full = join(root, entry.name);
      // Absicht (BUG-0172): auch Ordner ohne `.git` werden angeboten. Vorher galten
      // sie als „kein Projekt“ — lokal ohne Git zu arbeiten war damit nicht auffindbar.
      // Symlinks bleiben draußen (Dirent folgt nicht): depth 1, keine Ausgange.
      if (!entry.isDirectory()) continue;
      const hasGit = await stat(join(full, ".git")).then(() => true, () => false);
      projects.push({ path: full, name: entry.name, branch: hasGit ? await readBranch(full) : null, isGit: hasGit });
    }
  }
  // Git-Repos zuerst: sie haben eine Branch-Anzeige und sind die vertraute Auswahl.
  projects.sort((a, b) => Number(b.isGit) - Number(a.isGit) || a.name.localeCompare(b.name));
  // K5-atem: eine Wurzel wie das Home-Verzeichnis kann tausende Ordner haben. Die
  // Liste wird gekürzt, aber der Hinweis macht es sichtbar — nie still schweigen.
  const CAP = 200;
  if (projects.length > CAP) {
    warnings.push(`Projektliste auf die ersten ${CAP} Einträge gekürzt (${projects.length} Ordner gefunden) — engere projectRoots setzen`);
    projects.length = CAP;
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
 *
 * BUG-0171: a leaf that does not exist yet is allowed as long as its
 * nearest existing ancestor is inside an allowed root — that is exactly
 * the "neuer Ordner, in dem ich eine Session starten will"-Fall. Before,
 * `realpath()` threw on the missing leaf and the answer was "outside the
 * configured projectRoots", which was untrue. The remaining (lexical) tail
 * may not escape through `..`, and a symlink on the way is still resolved
 * and rejected when it points out of the root.
 */
export async function isProjectPathAllowed(projectPath: string, roots: readonly string[]): Promise<boolean> {
  if (roots.length === 0) return true;
  const anchor = await nearestExistingAncestor(projectPath);
  if (!anchor) return false;
  let realAnchor: string;
  try {
    realAnchor = await realpath(anchor);
  } catch {
    return false;
  }
  const tail = relative(anchor, resolve(projectPath));
  if (tail === "..") return false;
  if (tail.startsWith(`..${sep}`) || isAbsolute(tail)) return false;
  const candidate = tail ? join(realAnchor, tail) : realAnchor;
  for (const root of roots) {
    let realRoot: string;
    try {
      realRoot = await realpath(root);
    } catch {
      continue;
    }
    if (pathWithin(candidate, realRoot)) return true;
  }
  return false;
}

/**
 * T-PJ1: create a new project (git init) inside a configured root.
 * Name is validated strictly (no path traversal, no reserved names) so a
 * client can never write outside projectRoots — same allowlist spirit as
 * isProjectPathAllowed. Idempotent: returns { created: false } if the dir
 * exists with a .git already.
 */
export interface CreateProjectResult {
  created: boolean;
  project: DiscoveredProject;
  warning?: string;
}

/**
 * BUG-0171: a session target inside an allowed root may not exist yet — the
 * user wants to start a session in a fresh folder and have AncientVoid create
 * it. Exactly one level is created (the leaf): a typo must not build a whole
 * tree. A path that looks absolute but has no drive on Windows (`/coding`
 * resolves drive-relative to `E:\coding`, silently) is rejected with an honest
 * message instead of being quietly created.
 */
export async function ensureProjectDir(projectPath: string, roots: readonly string[]): Promise<{ created: boolean; path: string }> {
  const driveOrUnc = /^[a-zA-Z]:[\\/]|^\\\\/;
  if (pathStyle() === "win32" ? !driveOrUnc.test(projectPath) : !projectPath.startsWith("/")) {
    throw new Error(`Projektpfad muss vollstaendig (absolut) angegeben werden: "${projectPath}" — auf Windows mit Laufwerksbuchstaben, z. B. "E:\\Coding\\projekt"`);
  }
  const target = resolve(projectPath);
  const leaf = await lstat(target).catch(() => null);
  if (leaf?.isDirectory()) return { created: false, path: target };
  if (leaf) throw new Error(`"${target}" existiert, ist aber kein Ordner.`);
  if (!(await isProjectPathAllowed(target, roots))) {
    throw new Error(`Projektpfad liegt außerhalb der konfigurierten projectRoots: ${target}`);
  }
  const parent = resolve(target, "..");
  if (!(await stat(parent).then((s) => s.isDirectory(), () => false))) {
    throw new Error(`Ordner existiert nicht, und sein Elternordner auch nicht: ${parent}`);
  }
  await mkdir(target);
  return { created: true, path: target };
}

const PROJECT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export async function createProject(
  roots: readonly string[],
  name: string,
  init: { git: (args: string[], cwd: string) => Promise<{ code: number; stderr: string }> },
): Promise<CreateProjectResult> {
  if (!PROJECT_NAME_RE.test(name)) {
    throw new Error(`Ungültiger Projektname: "${name}" (erlaubt: Buchstaben, Ziffern, . _ -, max 64 Zeichen; keine Pfade)`);
  }
  if (roots.length === 0) {
    throw new Error("Keine projectRoots konfiguriert — Projekt-Anlegen nicht möglich.");
  }
  const root = roots[0]!;
  const projectPath = join(root, name);
  // Path traversal defence: name contains no separators by regex, but belt-and-braces.
  const realRoot = await realpath(root);
  if (!(projectPath + sep).startsWith(realRoot + sep) && projectPath !== realRoot) {
    throw new Error("Projektpfad liegt außerhalb der projectRoots.");
  }
  const hasGit = await stat(join(projectPath, ".git")).then(() => true, () => false);
  if (hasGit) {
    return { created: false, project: { path: projectPath, name, branch: await readBranch(projectPath), isGit: true } };
  }
  const exists = await stat(projectPath).then(() => true, () => false);
  if (exists) {
    throw new Error(`Verzeichnis "${name}" existiert bereits ohne .git — nicht über den Hub überschreiben.`);
  }
  await (await import("node:fs/promises")).mkdir(projectPath, { recursive: true });
  const r = await init.git(["init", "--initial-branch=main"], projectPath);
  if (r.code !== 0) {
    throw new Error(`git init fehlgeschlagen: ${r.stderr.slice(0, 200)}`);
  }
  return { created: true, project: { path: projectPath, name, branch: "main", isGit: true } };
}
