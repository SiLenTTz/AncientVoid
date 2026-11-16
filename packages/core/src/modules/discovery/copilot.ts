import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_HOST_ID, type DiscoveredSession, type DiscoverySource } from "@ancientvoid/contracts";
import { classifyProject, clearTemporaryUnderRoots } from "./project-origin.ts";
import { clip, outsideRoots } from "./text.ts";

/**
 * EPIC-P35 T35.5: read-only Scanner für GitHub Copilot CLI. Der Store liegt in
 * `~/.copilot/session-store.db` (`sessions` mit id/cwd/branch/summary und ISO-Zeiten,
 * `turns` mit user_message/assistant_response) — live verifiziert am 07.11.2026
 * (copilot 1.0.104, Linux; WAL daneben, `mode=ro` reicht).
 *
 * Fortsetzen ist belegt (EPIC-P35 T35.3, 07.11.2026): Übernahme einer fremden
 * Session aus der Erkennung (Adoption `93ba3d3d…` „remember the number 42“ →
 * `-r <id>` → Antwort „42“) und „Weitermachen“ nach Worker-Kill mitten im Zug
 * (Codewort LAVA-9 erinnert).
 */
export function defaultCopilotDir(): string {
  return process.env.COPILOT_HOME ?? join(homedir(), ".copilot");
}

const LIVE_WINDOW_MS = 90_000;
const REQUIRED = ["id", "updated_at"];

interface Row {
  id: string;
  cwd?: string | null;
  summary?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  first_user?: string | null;
  last_user?: string | null;
}

function unsupported(where: string, now: string, why: string): DiscoveredSession {
  return {
    hubSessionId: null,
    project: where,
    adapter: "copilot",
    status: "unsupported-format",
    controlMode: "observed",
    harness: "cli",
    hostId: DEFAULT_HOST_ID,
    nativeSessionId: `unknown:${why}`,
    resumeVersion: 0,
    observedAt: now,
    unsupportedResume: true,
    fork: false,
    parentSessionId: null,
  };
}

export function scanCopilotSessions(dir: string, now = new Date().toISOString(), projectRoots: readonly string[] = []): DiscoveredSession[] {
  const dbPath = join(dir, "session-store.db");
  if (!existsSync(dbPath)) return [];
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(`file:${dbPath}?mode=ro`, { readOnly: true });
  } catch {
    return [unsupported(dir, now, "unreadable-db")];
  }
  try {
    const columns = new Set((db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]).map((c) => c.name));
    if (!REQUIRED.every((c) => columns.has(c))) return [unsupported(dir, now, "schema")];
    const optional = ["cwd", "summary", "created_at", "updated_at"].filter((c) => columns.has(c));
    // Titel: summary (copilot schreibt dort die erste Aufgabe), sonst erster
    // Nutzertext. Vorschau: was die Person zuletzt gesagt hat.
    const firstUser = `(SELECT t.user_message FROM turns t WHERE t.session_id = s.id AND t.user_message IS NOT NULL AND t.user_message != '' ORDER BY t.turn_index LIMIT 1)`;
    const lastUser = `(SELECT p.user_message FROM turns p WHERE p.session_id = s.id AND p.user_message IS NOT NULL AND p.user_message != '' ORDER BY p.turn_index DESC LIMIT 1)`;
    const hasTurns = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'turns'").all() as unknown[]).length > 0;
    const rows = db
      .prepare(`SELECT ${[...REQUIRED.map((c) => `s.${c}`), ...optional.map((c) => `s.${c}`), ...(hasTurns ? [`${firstUser} AS first_user`, `${lastUser} AS last_user`] : [])].join(", ")} FROM sessions s`)
      .all() as unknown as Row[];
    const roots = projectRoots.map((r) => resolve(r));
    const nowMs = Date.parse(now);
    const out: DiscoveredSession[] = [];
    for (const row of rows) {
      if (!row.id) continue;
      const origin = row.cwd ? classifyProject(row.cwd) : { project: dir, worktree: null, temporary: false };
      if (row.cwd && outsideRoots(origin.project, roots)) continue;
      const updatedMs = Date.parse(row.updated_at ?? row.created_at ?? "");
      const observedAt = Number.isNaN(updatedMs) ? now : new Date(updatedMs).toISOString();
      const title = row.summary?.trim() || row.first_user?.trim() || null;
      out.push({
        hubSessionId: null,
        project: origin.project,
        adapter: "copilot",
        status: "observed",
        controlMode: "observed",
        harness: "cli",
        hostId: DEFAULT_HOST_ID,
        nativeSessionId: row.id,
        resumeVersion: 1,
        observedAt,
        unsupportedResume: false,
        fork: false,
        parentSessionId: null,
        title: title ? clip(title, 80) : null,
        preview: row.last_user ? clip(row.last_user, 160) : null,
        live: nowMs - updatedMs < LIVE_WINDOW_MS && !Number.isNaN(updatedMs),
        worktree: origin.worktree,
        temporary: origin.temporary,
      });
    }
    clearTemporaryUnderRoots(out, roots);
    return out;
  } catch {
    return [unsupported(dir, now, "schema")];
  } finally {
    db.close();
  }
}

export function copilotDiscoverySource(dir: string, projectRoots: readonly string[] = []): DiscoverySource {
  return {
    id: "copilot-sessions",
    list: async () => scanCopilotSessions(dir, new Date().toISOString(), projectRoots),
  };
}
