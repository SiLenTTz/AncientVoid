import { existsSync } from "node:fs";
import type { WorktreeManager } from "./worktree.ts";

/** EPIC-P14: what `hubctl worktrees` knows about a session's worktree. */
export interface WorktreeSessionRow {
  id: string;
  project: string;
  status: string;
  archived: boolean;
  worktreeSha: string | null;
}

/** `work`: uncommitted files or commits the project lacks (BUG-0027).
 * `unknown`: the check itself failed — treated like work, never removed. */
export type WorktreeState = "clean" | "work" | "unknown";

export interface WorktreeEntry {
  sessionId: string;
  project: string;
  path: string;
  sizeBytes: number;
  status: string;
  archived: boolean;
  state: WorktreeState;
  /** A process has its cwd inside the worktree (e.g. a persistent ACP worker). */
  inUse: boolean;
  prunable: boolean;
}

const RUNNING = new Set(["starting", "working", "waiting_approval", "stopping"]);
const ENDED = new Set(["stopped", "error"]);

/** Only a clean, unused worktree of an archived or ended session may go. */
function prunable(row: WorktreeSessionRow, state: WorktreeState, inUse: boolean): boolean {
  if (state !== "clean" || inUse || RUNNING.has(row.status)) return false;
  return row.archived || ENDED.has(row.status);
}

export async function scanWorktrees(
  worktrees: WorktreeManager,
  sessions: readonly WorktreeSessionRow[],
  inUse: (path: string, session: WorktreeSessionRow) => Promise<boolean>,
): Promise<WorktreeEntry[]> {
  const entries: WorktreeEntry[] = [];
  for (const row of sessions) {
    const path = worktrees.pathFor(row.id);
    if (!existsSync(path)) continue;
    let state: WorktreeState;
    try {
      state = (await worktrees.hasWork(row.id, row.worktreeSha, row.project)) ? "work" : "clean";
    } catch {
      state = "unknown";
    }
    const used = await inUse(path, row);
    const sizeBytes = await worktrees.diskUsageBytes(path).catch(() => 0);
    entries.push({
      sessionId: row.id,
      project: row.project,
      path,
      sizeBytes,
      status: row.status,
      archived: row.archived,
      state,
      inUse: used,
      prunable: prunable(row, state, used),
    });
  }
  return entries;
}

export interface PruneResult {
  removed: string[];
  failed: { path: string; error: string }[];
}

/** Dry run unless `apply`. Re-checks right before each removal: the scan may
 * be old and an agent may have written since. */
export async function pruneWorktrees(
  worktrees: WorktreeManager,
  sessions: readonly WorktreeSessionRow[],
  entries: readonly WorktreeEntry[],
  inUse: (path: string, session: WorktreeSessionRow) => Promise<boolean>,
  apply: boolean,
): Promise<PruneResult> {
  const result: PruneResult = { removed: [], failed: [] };
  const byId = new Map(sessions.map((row) => [row.id, row]));
  for (const entry of entries) {
    if (!entry.prunable) continue;
    if (!apply) {
      result.removed.push(entry.path);
      continue;
    }
    const row = byId.get(entry.sessionId);
    if (!row) continue;
    try {
      if ((await worktrees.hasWork(row.id, row.worktreeSha, row.project)) || (await inUse(entry.path, row))) continue;
      await worktrees.remove(row.id, row.project);
      result.removed.push(entry.path);
    } catch (err) {
      result.failed.push({ path: entry.path, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}
