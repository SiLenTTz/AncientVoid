import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_HOST_ID,
  type DiscoveredSession,
  type DiscoverySource,
} from "@uacc/contracts";

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

export function scanClaudeSessions(claudeDir: string, now = new Date().toISOString(), knownProjects: readonly string[] = []): DiscoveredSession[] {
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
        out.push(claudeItem(projectName, name.slice(0, -".jsonl".length), at, null, "observed"));
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
            claudeItem(projectName, agent.slice(0, -".jsonl".length), observed(agentStat.mtimeMs, now), name, "observed"),
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
    const sql = `SELECT id, directory, time_created, time_updated${parentColumn ? `, ${parentColumn} AS parentId` : ""} FROM session`;
    const rows = db.prepare(sql).all() as {
      id?: string;
      directory?: string | null;
      time_created?: number | string;
      time_updated?: number | string;
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
      return [opencodeItem(project, row.id, updated, parent, "observed")];
    });
  } catch {
    return [opencodeItem(dataDir, "unknown:schema", now, null, "unsupported-format")];
  } finally {
    db.close();
  }
}

export function claudeDiscoverySource(claudeDir: string, knownProjectRoots: readonly string[] = []): DiscoverySource {
  return {
    id: "claude-projects",
    // The candidates for un-munging are computed per scan, not once: roots
    // and their projects change while the hub runs.
    list: async () => scanClaudeSessions(claudeDir, new Date().toISOString(), await knownProjectCandidates(knownProjectRoots)),
  };
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
