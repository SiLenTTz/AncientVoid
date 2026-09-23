import { DatabaseSync } from "node:sqlite";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Real, verified (Linux, this machine, 2026-09-18): Cursor is an Electron
 * VSCode fork and lays out `~/.config/Cursor/User/{globalStorage,
 * workspaceStorage}` exactly like every other Electron `userData` app.
 * macOS (`~/Library/Application Support/Cursor/User`) and Windows
 * (`%APPDATA%\Cursor\User`) below follow that same universal Electron
 * convention but have NOT been verified live on this machine (no macOS/
 * Windows box available) — override via `config.userDir` if wrong.
 */
export function defaultUserDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  if (process.platform === "darwin") return join(home, "Library", "Application Support", "Cursor", "User");
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "Cursor", "User");
  return join(home, ".config", "Cursor", "User");
}

/** Real: each `workspaceStorage/<hash>/workspace.json` is `{"folder":
 * "file:///abs/path"}` — verified live against this machine's own open
 * Cursor windows. Normalizes both sides (trailing slash) before comparing. */
export function findWorkspaceId(userDir: string, projectPath: string): string | undefined {
  const workspaceStorageDir = join(userDir, "workspaceStorage");
  if (!existsSync(workspaceStorageDir)) return undefined;
  const target = pathToFileURL(projectPath).href.replace(/\/$/, "");
  let entries: string[];
  try {
    entries = readdirSync(workspaceStorageDir);
  } catch {
    return undefined;
  }
  for (const hash of entries) {
    const wsJsonPath = join(workspaceStorageDir, hash, "workspace.json");
    if (!existsSync(wsJsonPath)) continue;
    try {
      const parsed = JSON.parse(readFileSync(wsJsonPath, "utf8")) as { folder?: string };
      if (typeof parsed.folder === "string" && parsed.folder.replace(/\/$/, "") === target) {
        return hash;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

/** Real (never `immutable=1` — see index.ts's doc comment on why: verified
 * live that `immutable=1` fails to see even schema created moments earlier
 * in the same WAL-mode file, let alone Cursor's ongoing writes). A fresh
 * connection is opened and closed per call — cheap at the adapter's poll
 * interval, and guarantees a current view instead of relying on unverified
 * long-lived-connection cache behavior against a file another process
 * keeps writing to. */
export function openReadOnly(dbPath: string): DatabaseSync {
  return new DatabaseSync(`file:${dbPath}?mode=ro`, { readOnly: true });
}

const REQUIRED_TABLES = ["composerHeaders", "cursorDiskKV"];
const REQUIRED_COMPOSER_HEADER_COLUMNS = ["composerId", "workspaceId", "lastUpdatedAt", "isArchived", "isSubagent"];

/** K9: schema-break detection. Real, verified table/column names as of
 * 2026-09-18 — a Cursor update that renames or drops any of these is
 * exactly the "Schema-Bruch" this adapter must fail loud on, not silently
 * misinterpret. */
export function verifySchema(db: DatabaseSync): { ok: true } | { ok: false; detail: string } {
  const tables = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => (r as { name: string }).name),
  );
  for (const t of REQUIRED_TABLES) {
    if (!tables.has(t)) return { ok: false, detail: `missing table "${t}"` };
  }
  const columns = new Set(
    db
      .prepare("PRAGMA table_info(composerHeaders)")
      .all()
      .map((r) => (r as { name: string }).name),
  );
  for (const c of REQUIRED_COMPOSER_HEADER_COLUMNS) {
    if (!columns.has(c)) return { ok: false, detail: `composerHeaders missing column "${c}"` };
  }
  return { ok: true };
}

/** Most recently updated, non-archived, non-subagent composer for a
 * workspace — "the chat you're actually looking at", not a sub-task. */
export function findMostRecentComposerId(db: DatabaseSync, workspaceId: string): string | undefined {
  const row = db
    .prepare(
      "SELECT composerId FROM composerHeaders WHERE workspaceId = ? AND isArchived = 0 AND isSubagent = 0 ORDER BY lastUpdatedAt DESC LIMIT 1",
    )
    .get(workspaceId) as { composerId?: string } | undefined;
  return row?.composerId;
}
