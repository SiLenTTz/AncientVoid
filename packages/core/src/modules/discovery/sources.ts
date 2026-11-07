import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_HOST_ID,
  type DiscoveredSession,
  type DiscoverySource,
} from "@ancientvoid/contracts";
import { readClaudeMeta } from "./claude-meta.ts";
import type { ClaudeLive } from "./claude-live.ts";
import { classifyProject, type ProjectOrigin } from "./project-origin.ts";
import { outsideRoots } from "./text.ts";

/** ADR-0040: a transcript written this recently is probably open in another harness. */
export const LIVE_WINDOW_MS = 90_000;

/**
 * Claude Code layout verified in adapter-claude-clip (Linux, 2026-09-19).
 * The project directory name is not reversed into a filesystem path:
 * `-` from `/` and a literal `-` are ambiguous. Callers must not treat
 * `project` as a cwd.
 */
export function defaultClaudeDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return join(home, ".claude");
}

/** Cursor user dir, same Linux default as adapter-cursor-clip. */
export function defaultCursorUserDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  if (process.platform === "darwin") return join(home, "Library", "Application Support", "Cursor", "User");
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "Cursor", "User");
  return join(home, ".config", "Cursor", "User");
}

/**
 * opencode keeps one SQLite store per user (~/.local/share/opencode/opencode.db,
 * verified on Linux 2026-08-31: tables `session`/`message`/`part`, ids `ses_*`,
 * `time_*` epoch-ms, `parent_id` for compacted/forked children).
 */
export function defaultOpencodeDataDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  if (process.platform === "darwin") return join(home, "Library", "Application Support", "opencode");
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "opencode");
  const xdg = process.env.XDG_DATA_HOME;
  return xdg ? join(xdg, "opencode") : join(home, ".local", "share", "opencode");
}

function observed(mtimeMs: number, fallback: string): string {
  const date = new Date(mtimeMs);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function claudeItem(
  project: string,
  nativeSessionId: string | null,
  observedAt: string,
  parentSessionId: string | null,
  status: string,
  extra: Pick<DiscoveredSession, "title" | "preview" | "live" | "worktree" | "temporary"> = {},
): DiscoveredSession {
  const unsupported = status === "unsupported-format";
  return {
    hubSessionId: null,
    project,
    adapter: "claude",
    status,
    controlMode: "observed",
    harness: "cli",
    hostId: DEFAULT_HOST_ID,
    nativeSessionId,
    resumeVersion: unsupported ? 0 : 1,
    observedAt,
    unsupportedResume: unsupported,
    fork: false,
    parentSessionId,
    ...extra,
  };
}

/** Claude Code munges a cwd into a directory name: every non-alphanumeric
 * character becomes `-` — observed live: `/mnt/omarchy_data/…` becomes
 * `-mnt-omarchy-data-…` (underscores too, despite adapter-claude-clip's
 * older `/`-only note). Not reversible in general (dashes in segment
 * names) — so we match against known project paths instead of guessing. */
export function unMungeProject(munged: string, knownProjects: readonly string[]): string {
  for (const known of knownProjects) {
    if (known.replace(/[^a-zA-Z0-9]/g, "-") === munged) return known;
  }
  return munged;
}

/** Echtes Projekt einer Session: `cwd` aus dem Transkript; fehlt es, bleibt der (so gut es geht zurückgeführte) Ordnername. */
function originOf(cwd: string | null, fallback: string): ProjectOrigin {
  if (cwd) return classifyProject(cwd);
  return { project: fallback, worktree: null, temporary: fallback.startsWith("-tmp-") || fallback.startsWith("/tmp/") };
}

export function scanClaudeSessions(
  claudeDir: string,
  now = new Date().toISOString(),
  knownProjects: readonly string[] = [],
  /** Sitzungs-IDs, die `claude agents` als offen meldet — auch still gewordene Terminals (EPIC-P34 T34.7). */
  liveIds: ReadonlySet<string> = new Set(),
): DiscoveredSession[] {
  if (!existsSync(claudeDir)) {
    return [claudeItem(claudeDir, "unknown:missing-dir", now, null, "unsupported-format")];
  }
  const projects = join(claudeDir, "projects");
  if (!existsSync(projects)) return [];
  let projectNames: string[];
  try {
    projectNames = readdirSync(projects);
  } catch {
    return [claudeItem(projects, "unknown:unreadable", now, null, "unsupported-format")];
  }
  const out: DiscoveredSession[] = [];
  for (const rawName of projectNames) {
    // The munged dir name becomes a readable path again when the project
    // is known — otherwise the raw name stays visible (never dropped).
    const projectName = unMungeProject(rawName, knownProjects);
    const projectDir = join(projects, rawName);
    let entries: string[];
    try {
      if (!statSync(projectDir).isDirectory()) continue;
      entries = readdirSync(projectDir);
    } catch {
      out.push(claudeItem(projectName, `unknown:${projectName}`, now, null, "unsupported-format"));
      continue;
    }
    // Dateien vor Ordnern: Subagenten erben das Projekt ihrer Hauptsession.
    entries.sort((a, b) => Number(b.endsWith(".jsonl")) - Number(a.endsWith(".jsonl")));
    for (const name of entries) {
      if (name === "memory") continue;
      const path = join(projectDir, name);
      let st;
      try {
        st = statSync(path);
      } catch {
        continue;
      }
      const at = observed(st.mtimeMs, now);
      if (st.isFile() && name.endsWith(".jsonl")) {
        const meta = readClaudeMeta(path, st);
        const id = name.slice(0, -".jsonl".length);
        const live = Date.parse(now) - st.mtimeMs < LIVE_WINDOW_MS || liveIds.has(id);
        const origin = originOf(meta.cwd, projectName);
        out.push(claudeItem(origin.project, id, at, null, "observed", { title: meta.title, preview: meta.preview, live, worktree: origin.worktree, temporary: origin.temporary }));
        continue;
      }
      if (st.isFile()) {
        out.push(claudeItem(projectName, `unknown:${name}`, at, null, "unsupported-format"));
        continue;
      }
      if (!st.isDirectory()) continue;
      const sub = join(path, "subagents");
      let agents: string[] = [];
      if (existsSync(sub)) {
        try {
          agents = readdirSync(sub).filter((agent) => agent.endsWith(".jsonl"));
        } catch {
          agents = [];
        }
      }
      if (agents.length > 0) {
        const parentPath = join(projectDir, `${name}.jsonl`);
        let parentCwd: string | null = null;
        try {
          parentCwd = readClaudeMeta(parentPath, statSync(parentPath)).cwd;
        } catch {
          // Hauptsession fehlt: der Ordnername bleibt
        }
        const origin = originOf(parentCwd, projectName);
        for (const agent of agents) {
          const agentPath = join(sub, agent);
          let agentStat;
          try {
            agentStat = statSync(agentPath);
          } catch {
            continue;
          }
          if (!agentStat.isFile()) continue;
          out.push(
            claudeItem(origin.project, agent.slice(0, -".jsonl".length), observed(agentStat.mtimeMs, now), name, "observed", { worktree: origin.worktree, temporary: origin.temporary }),
          );
        }
        continue;
      }
      if (!existsSync(join(projectDir, `${name}.jsonl`))) {
        out.push(claudeItem(projectName, `unknown:${name}`, at, null, "unsupported-format"));
      }
    }
  }
  return out;
}

function cursorItem(
  project: string,
  nativeSessionId: string | null,
  observedAt: string,
  parentSessionId: string | null,
  status: string,
): DiscoveredSession {
  const unsupported = status === "unsupported-format";
  return {
    hubSessionId: null,
    project,
    adapter: "cursor-clip",
    status,
    controlMode: "observed",
    harness: "ide",
    hostId: DEFAULT_HOST_ID,
    nativeSessionId,
    resumeVersion: unsupported ? 0 : 1,
    observedAt,
    unsupportedResume: unsupported,
    fork: false,
    parentSessionId,
  };
}

function workspaceFolder(userDir: string, workspaceId: string): string {
  const meta = join(userDir, "workspaceStorage", workspaceId, "workspace.json");
  if (!existsSync(meta)) return workspaceId;
  try {
    const parsed = JSON.parse(readFileSync(meta, "utf8")) as { folder?: string };
    if (typeof parsed.folder === "string" && parsed.folder.startsWith("file:")) return fileURLToPath(parsed.folder);
  } catch {
    return workspaceId;
  }
  return workspaceId;
}

export function scanCursorComposers(userDir: string, now = new Date().toISOString()): DiscoveredSession[] {
  const dbPath = join(userDir, "globalStorage", "state.vscdb");
  if (!existsSync(dbPath)) return [];
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(`file:${dbPath}?mode=ro`, { readOnly: true });
  } catch {
    return [cursorItem(userDir, "unknown:unreadable-db", now, null, "unsupported-format")];
  }
  try {
    const tables = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => (row as { name: string }).name),
    );
    if (!tables.has("composerHeaders")) return [cursorItem(userDir, "unknown:schema", now, null, "unsupported-format")];
    const columns = new Set(
      db
        .prepare("PRAGMA table_info(composerHeaders)")
        .all()
        .map((row) => (row as { name: string }).name),
    );
    for (const required of ["composerId", "workspaceId", "lastUpdatedAt", "isSubagent"]) {
      if (!columns.has(required)) return [cursorItem(userDir, "unknown:schema", now, null, "unsupported-format")];
    }
    const parentColumn = ["parentComposerId", "parentId"].find((name) => columns.has(name));
    const sql = `SELECT composerId, workspaceId, lastUpdatedAt, isSubagent${parentColumn ? `, ${parentColumn} AS parentId` : ""} FROM composerHeaders`;
    const rows = db.prepare(sql).all() as {
      composerId?: string;
      workspaceId?: string;
      lastUpdatedAt?: number | string;
      isSubagent?: number;
      parentId?: string | null;
    }[];
    return rows.flatMap((row) => {
      if (!row.composerId) return [];
      const updated =
        typeof row.lastUpdatedAt === "number"
          ? observed(row.lastUpdatedAt, now)
          : typeof row.lastUpdatedAt === "string"
            ? row.lastUpdatedAt
            : now;
      const project = row.workspaceId ? workspaceFolder(userDir, row.workspaceId) : userDir;
      const parent = parentColumn && row.parentId ? row.parentId : null;
      return [cursorItem(project, row.composerId, updated, parent, row.isSubagent ? "subagent" : "observed")];
    });
  } catch {
    return [cursorItem(userDir, "unknown:schema", now, null, "unsupported-format")];
  } finally {
    db.close();
  }
}

function opencodeItem(
  project: string,
  nativeSessionId: string | null,
  observedAt: string,
  parentSessionId: string | null,
  status: string,
  title: string | null = null,
): DiscoveredSession {
  const unsupported = status === "unsupported-format";
  return {
    hubSessionId: null,
    project,
    adapter: "opencode",
    status,
    controlMode: "observed",
    harness: "cli",
    hostId: DEFAULT_HOST_ID,
    nativeSessionId,
    resumeVersion: unsupported ? 0 : 1,
    observedAt,
    unsupportedResume: unsupported,
    fork: false,
    parentSessionId,
    title,
  };
}

/**
 * Read-only scan of opencode's SQLite session store (ADR-0011: sessions this
 * hub did not start). A set-but-missing or unreadable store surfaces as one
 * `unsupported-format` row instead of being skipped (K9: visible, not dropped).
 */
export function scanOpencodeSessions(
  dataDir: string,
  now = new Date().toISOString(),
  projectRoots: readonly string[] = [],
): DiscoveredSession[] {
  const dbPath = join(dataDir, "opencode.db");
  if (!existsSync(dbPath)) return [opencodeItem(dataDir, "unknown:missing-db", now, null, "unsupported-format")];
  // No roots configured → no filtering (backwards compatible).
  const allowed = projectRoots.length
    ? projectRoots.map((root) => resolve(root))
    : null;
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(`file:${dbPath}?mode=ro`, { readOnly: true });
  } catch {
    return [opencodeItem(dataDir, "unknown:unreadable-db", now, null, "unsupported-format")];
  }
  try {
    const tables = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => (row as { name: string }).name),
    );
    if (!tables.has("session")) return [opencodeItem(dataDir, "unknown:schema", now, null, "unsupported-format")];
    const columns = new Set(
      db
        .prepare("PRAGMA table_info(session)")
        .all()
        .map((row) => (row as { name: string }).name),
    );
    for (const required of ["id", "directory", "time_created", "time_updated"]) {
      if (!columns.has(required)) return [opencodeItem(dataDir, "unknown:schema", now, null, "unsupported-format")];
    }
    const parentColumn = columns.has("parent_id") ? "parent_id" : null;
    const titleColumn = columns.has("title") ? ", title" : "";
    const sql = `SELECT id, directory, time_created, time_updated${titleColumn}${parentColumn ? `, ${parentColumn} AS parentId` : ""} FROM session`;
    const rows = db.prepare(sql).all() as {
      id?: string;
      directory?: string | null;
      time_created?: number | string;
      time_updated?: number | string;
      title?: string | null;
      parentId?: string | null;
    }[];
    return rows.flatMap((row) => {
      if (!row.id) return [];
      const updated =
        typeof row.time_updated === "number"
          ? observed(row.time_updated, now)
          : typeof row.time_updated === "string"
            ? row.time_updated
            : now;
      const project = row.directory || dataDir;
      // ADR-0011/K9: sessions outside the configured project roots are other
      // people's business — hide them unless no roots are configured.
      if (allowed && !allowed.some((root) => project === root || project.startsWith(root + "/"))) return [];
      const parent = parentColumn && row.parentId ? row.parentId : null;
      // opencode names untitled sessions "New session - <ISO date>" — that says nothing.
      const title = row.title && !/^New session - /i.test(row.title) ? row.title.replace(/\s+/g, " ").trim().slice(0, 80) : null;
      return [opencodeItem(project, row.id, updated, parent, "observed", title)];
    });
  } catch {
    return [opencodeItem(dataDir, "unknown:schema", now, null, "unsupported-format")];
  } finally {
    db.close();
  }
}

export function claudeDiscoverySource(claudeDir: string, knownProjectRoots: readonly string[] = [], liveSessions?: Pick<ClaudeLive, "list">): DiscoverySource {
  return {
    id: "claude-projects",
    // The candidates for un-munging are computed per scan, not once: roots
    // and their projects change while the hub runs.
    list: async () => {
      // Fällt `claude agents` aus, bleibt es beim 90-s-Fenster (ClaudeLive hält die letzte gute Liste, BUG-0049).
      const liveIds = new Set((await liveSessions?.list())?.map((s) => s.sessionId));
      const items = await scanClaudeSessions(claudeDir, new Date().toISOString(), await knownProjectCandidates(knownProjectRoots), liveIds);
      // Exact candidates only cover roots and direct children — deeper
      // projects (BUG-0057) need a filesystem walk from the roots.
      const roots = [...new Set([...knownProjectRoots.map((r) => resolve(r)), homedir()])];
      const resolved = new Map<string, string>();
      for (const item of items) {
        if (!item.project.startsWith("-")) continue;
        let project = resolved.get(item.project);
        if (project === undefined) {
          project = (await resolveMungedProject(item.project, roots)) ?? item.project;
          resolved.set(item.project, project);
        }
        item.project = project;
      }
      // EPIC-P34: ein Pfad unter einer konfigurierten Wurzel ist Arbeit des Nutzers, auch wenn die Wurzel selbst unter /tmp liegt.
      for (const item of items) {
        if (!item.temporary) continue;
        // Ein nicht zurückgeführter Ordnername wird über das gemungte Wurzel-Präfix zugeordnet (wie im Filter unten).
        const ownWork = knownProjectRoots.some((root) => {
          const abs = resolve(root);
          const munged = abs.replace(/[^a-zA-Z0-9]/g, "-");
          // Fabrik-Kopien bleiben Rauschen, auch unter einer Wurzel; nur der Ort (/tmp) wird durch die Wurzel aufgehoben.
          if (!outsideRoots(item.project, [abs])) return !item.project.slice(abs.length).split("/").some((seg) => seg.startsWith("harnez-exec-"));
          return (item.project.startsWith("-") && (item.project === munged || item.project.startsWith(`${munged}-`)));
        });
        if (ownWork) item.temporary = false;
      }
      // Same policy as opencode (ADR-0011): sessions outside the configured
      // roots are other people's business — hide them, but only when roots
      // are configured at all. Unresolved munged names are judged by their
      // munged root prefix (a name can only be under a root if the root's
      // munged form is a prefix) — e.g. "-tmp-…" never sits under a root.
      if (knownProjectRoots.length > 0) {
        const allowed = knownProjectRoots.map((r) => resolve(r));
        return items.filter(
          (item) =>
            item.status !== "observed" ||
            allowed.some((root) => {
              if (item.project === root || item.project.startsWith(root + "/")) return true;
              const rootMunged = root.replace(/[^a-zA-Z0-9]/g, "-");
              return item.project.startsWith("-") && (item.project === rootMunged || item.project.startsWith(rootMunged + "-"));
            }),
        );
      }
      return items;
    },
  };
}

/** Walk the filesystem from the given roots to turn a munged project name
 * back into the real path (BUG-0057: nested projects never matched the
 * direct-children candidates). Dash-ambiguity is resolved by preferring the
 * longest matching segment; unresolved names stay munged (fail loud). */
export async function resolveMungedProject(munged: string, roots: readonly string[]): Promise<string | null> {
  const { readdir } = await import("node:fs/promises");
  const MAX_DEPTH = 12; // cycle guard for symlinked directory layouts
  const walk = async (dir: string, tail: string, depth: number): Promise<string | null> => {
    if (tail === "") return dir;
    if (depth <= 0) return null;
    let entries: Dirent[];
    try {
      entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
    } catch {
      return null;
    }
    const matching = entries
      .filter((e) => e.isDirectory())
      .map((e) => ({ name: e.name, munged: e.name.replace(/[^a-zA-Z0-9]/g, "-") }))
      .filter(({ munged: m }) => tail === m || tail.startsWith(m + "-"))
      .sort((a, b) => b.munged.length - a.munged.length);
    for (const { name, munged: m } of matching) {
      const rest = tail === m ? "" : tail.slice(m.length + 1);
      const hit = await walk(join(dir, name), rest, depth - 1);
      if (hit) return hit;
    }
    return null;
  };
  for (const root of roots) {
    const rootMunged = root.replace(/[^a-zA-Z0-9]/g, "-");
    if (munged === rootMunged) return root;
    if (!munged.startsWith(rootMunged + "-")) continue;
    const hit = await walk(root, munged.slice(rootMunged.length + 1), MAX_DEPTH);
    if (hit) return hit;
  }
  return null;
}

/** Paths a munged Claude project name could be: each root itself, its
 * direct children (the hub's project layout) and the home dir's direct
 * children (where `~/my-project` sessions live). */
async function knownProjectCandidates(roots: readonly string[]): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const candidates = new Set<string>([homedir()]);
  for (const root of [...roots, homedir()]) {
    candidates.add(root);
    try {
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (entry.isDirectory()) candidates.add(join(root, entry.name));
      }
    } catch {
      // unreadable root — the root itself stays a candidate
    }
  }
  return [...candidates];
}

export function opencodeDiscoverySource(dataDir: string, knownProjectRoots: readonly string[] = []): DiscoverySource {
  return { id: "opencode-sessions", list: async () => scanOpencodeSessions(dataDir, new Date().toISOString(), knownProjectRoots) };
}

export function cursorDiscoverySource(userDir: string): DiscoverySource {
  return { id: "cursor-composers", list: async () => scanCursorComposers(userDir) };
}
