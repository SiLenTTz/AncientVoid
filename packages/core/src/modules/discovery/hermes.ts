import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_HOST_ID, type DiscoveredSession } from "@ancientvoid/contracts";
import { classifyProject, clearTemporaryUnderRoots } from "./project-origin.ts";
import { clip, outsideRoots } from "./text.ts";

/**
 * EPIC-P34 T34.8: read-only Scanner für Hermes. Die Sitzungen liegen in `~/.hermes/state.db` (`sessions`, `messages`);
 * `sessions/sessions.json` ist nur ein Routing-Spiegel und keine Liste. Fortsetzen ist belegt: `hermes --resume <id>`
 * (ADR-0036), der Hermes-Adapter übernimmt `adoptNativeSessionId`. Gemessen am 2026-11-07: 1 277 Sitzungen, davon
 * 1 029 `cron` (automatisch → temporär) und 25 `subagent`; die Vorschau je Sitzung kostet über `idx_messages_session` Millisekunden.
 */
export function defaultHermesDir(): string {
  return process.env.HERMES_HOME ?? join(homedir(), ".hermes");
}

const LIVE_WINDOW_MS = 90_000;
const REQUIRED = ["id", "source", "started_at"];

interface Row {
  id: string;
  source: string;
  parent_session_id?: string | null;
  started_at: number;
  ended_at?: number | null;
  cwd?: string | null;
  title?: string | null;
  last_activity_at?: number | null;
  hidden?: number | null;
}

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

function unsupported(where: string, now: string, why: string): DiscoveredSession {
  return {
    hubSessionId: null,
    project: where,
    adapter: "hermes",
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

export function scanHermesSessions(dir: string, now = new Date().toISOString(), projectRoots: readonly string[] = []): DiscoveredSession[] {
  const dbPath = join(dir, "state.db");
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
    const optional = ["parent_session_id", "ended_at", "cwd", "title", "last_activity_at", "hidden"].filter((c) => columns.has(c));
    const rows = db.prepare(`SELECT ${[...REQUIRED, ...optional].join(", ")} FROM sessions`).all() as unknown as Row[];
    const hasMessages = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'messages'").all() as unknown[]).length > 0;
    const last = hasMessages ? db.prepare("SELECT content FROM messages WHERE session_id = ? AND role IN ('user', 'assistant') AND content IS NOT NULL AND content != '' ORDER BY id DESC LIMIT 1") : null;
    const roots = projectRoots.map((r) => resolve(r));
    const nowMs = Date.parse(now);
    const out: DiscoveredSession[] = [];
    for (const row of rows) {
      if (!row.id || row.hidden === 1) continue;
      const origin = row.cwd ? classifyProject(row.cwd) : { project: dir, worktree: null, temporary: false };
      if (row.cwd && outsideRoots(origin.project, roots)) continue;
      const active = row.last_activity_at ?? row.ended_at ?? row.started_at;
      const content = (last?.get(row.id) as { content?: string } | undefined)?.content;
      out.push({
        hubSessionId: null,
        project: origin.project,
        adapter: "hermes",
        status: "observed",
        controlMode: "observed",
        harness: "cli",
        hostId: DEFAULT_HOST_ID,
        nativeSessionId: row.id,
        resumeVersion: 1,
        observedAt: iso(active),
        unsupportedResume: false,
        fork: false,
        parentSessionId: row.source === "subagent" ? (row.parent_session_id ?? null) : null,
        title: row.title ? clip(row.title, 80) : null,
        preview: content ? clip(content, 160) : null,
        live: row.ended_at == null && nowMs - active * 1000 < LIVE_WINDOW_MS,
        worktree: origin.worktree,
        // `cron` läuft von allein: dasselbe Rauschen wie /tmp, nur nach Herkunft statt nach Ort.
        temporary: origin.temporary || row.source === "cron",
      });
    }
    clearTemporaryUnderRoots(out.filter((i) => i.project !== dir), roots);
    return out;
  } catch {
    return [unsupported(dir, now, "schema")];
  } finally {
    db.close();
  }
}

export function hermesDiscoverySource(dir: string, projectRoots: readonly string[] = []) {
  return { id: "hermes-sessions", list: async () => scanHermesSessions(dir, new Date().toISOString(), projectRoots) };
}
