import { readdir, readlink } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { HubDatabase, pruneWorktrees, scanWorktrees, WorktreeManager, type WorktreeEntry, type WorktreeSessionRow } from "@uacc/core";

/** True when a process has its cwd inside `path` (Linux /proc). A persistent
 * worker (ACP, app-server) keeps the worktree as cwd, even across a hub
 * restart — removing it would pull the directory out from under the process.
 * Without /proc the answer is "yes": unknown means keep (fail safe). */
export async function cwdInside(path: string, procDir = "/proc"): Promise<boolean> {
  const root = resolve(path);
  let pids: string[];
  try {
    pids = (await readdir(procDir)).filter((name) => /^\d+$/.test(name));
  } catch {
    return true;
  }
  for (const pid of pids) {
    const cwd = await readlink(join(procDir, pid, "cwd")).catch(() => null);
    if (cwd === null) continue; // process gone or not ours to read
    if (cwd === root || cwd.startsWith(root + sep)) return true;
  }
  return false;
}

function rowsOf(dbPath: string): WorktreeSessionRow[] {
  const db = new HubDatabase(dbPath);
  return (
    db.prepare("SELECT id, project, status, archived, worktree_sha FROM sessions WHERE worktree_sha IS NOT NULL").all() as {
      id: string;
      project: string;
      status: string;
      archived: number;
      worktree_sha: string | null;
    }[]
  ).map((r) => ({ id: r.id, project: r.project, status: r.status, archived: r.archived === 1, worktreeSha: r.worktree_sha }));
}

const mib = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

function line(e: WorktreeEntry): string {
  const note = e.prunable ? "entfernbar" : e.state !== "clean" ? "Arbeit — bleibt" : e.inUse ? "Prozess aktiv — bleibt" : "aktive Session — bleibt";
  return `${e.sessionId.slice(0, 8)}  ${e.status.padEnd(16)} ${(e.archived ? "archiviert" : "aktiv").padEnd(10)} ${e.state.padEnd(7)} ${mib(e.sizeBytes).padStart(10)}  ${note}  ${e.project}`;
}

/** `hubctl worktrees [prune [--apply]] [--db <hub.db>]`. Local, like `workers`:
 * the worktrees live on this machine, next to the database. */
export async function runWorktrees(args: string[], print: (text: string) => void = console.log): Promise<void> {
  const dbIdx = args.indexOf("--db");
  const dbPath = dbIdx >= 0 ? (args[dbIdx + 1] ?? "data/hub.db") : "data/hub.db";
  const sub = args[0] && !args[0].startsWith("--") ? args[0] : "list";
  if (sub !== "list" && sub !== "prune") throw new Error(`unbekannter Unterbefehl: ${sub}`);
  const worktrees = new WorktreeManager(resolve(dirname(dbPath), "worktrees"));
  const sessions = rowsOf(dbPath);
  const entries = await scanWorktrees(worktrees, sessions, cwdInside);
  if (entries.length === 0) return void print("keine Session-Worktrees");
  for (const e of entries) print(line(e));
  const total = entries.reduce((sum, e) => sum + e.sizeBytes, 0);
  const free = entries.filter((e) => e.prunable).reduce((sum, e) => sum + e.sizeBytes, 0);
  print(`${entries.length} Worktrees, ${mib(total)}; entfernbar: ${entries.filter((e) => e.prunable).length} (${mib(free)})`);
  if (sub === "list") return;
  const apply = args.includes("--apply");
  const result = await pruneWorktrees(worktrees, sessions, entries, cwdInside, apply);
  for (const path of result.removed) print(`${apply ? "entfernt" : "würde entfernen"}: ${path}`);
  for (const f of result.failed) print(`FEHLER ${f.path}: ${f.error}`);
  if (!apply && result.removed.length > 0) print("Trockenlauf — mit --apply wirklich entfernen.");
}
