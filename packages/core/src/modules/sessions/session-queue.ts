import { randomUUID } from "node:crypto";
import type { PromptAttachment } from "@ancientvoid/contracts";
import type { HubDatabase } from "../../platform/index.ts";

/** EPIC-P15 T15.3: a prompt waiting for the running turn to end. */
export interface QueuedPrompt {
  id: string;
  sessionId: string;
  text: string;
  attachments?: PromptAttachment[];
  actor: string | null;
  createdAt: string;
}

interface QueueRow {
  id: string;
  session_id: string;
  text: string;
  attachments: string | null;
  actor: string | null;
  created_at: string;
}

/**
 * Persistent per-session prompt queue (K7: a hub restart keeps what was queued).
 * The manager takes the first entry when a turn ends; nothing here sends anything.
 */
export class SessionQueue {
  private readonly db: HubDatabase;

  constructor(db: HubDatabase) {
    this.db = db;
  }

  add(sessionId: string, text: string, attachments: PromptAttachment[] | undefined, actor: string | null): QueuedPrompt {
    const item: QueuedPrompt = {
      id: randomUUID(),
      sessionId,
      text,
      ...(attachments?.length ? { attachments } : {}),
      actor,
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare("INSERT INTO session_queue (id, session_id, text, attachments, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(item.id, sessionId, text, item.attachments ? JSON.stringify(item.attachments) : null, actor, item.createdAt);
    return item;
  }

  list(sessionId: string): QueuedPrompt[] {
    const rows = this.db
      .prepare("SELECT * FROM session_queue WHERE session_id = ? ORDER BY created_at ASC, rowid ASC")
      .all(sessionId) as unknown as QueueRow[];
    return rows.map(toItem);
  }

  count(sessionId: string): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM session_queue WHERE session_id = ?").get(sessionId) as { n: number }).n;
  }

  /** The oldest entry, removed in one step — an entry is sent at most once. */
  take(sessionId: string): QueuedPrompt | null {
    const first = this.list(sessionId)[0];
    if (!first) return null;
    this.db.prepare("DELETE FROM session_queue WHERE id = ?").run(first.id);
    return first;
  }

  /** BUG-0114: ein bestimmter Eintrag, atomar entfernt — „Jetzt senden" nimmt statt zu warten. */
  takeById(sessionId: string, id: string): QueuedPrompt | null {
    const item = this.list(sessionId).find((q) => q.id === id) ?? null;
    if (!item) return null;
    this.db.prepare("DELETE FROM session_queue WHERE id = ? AND session_id = ?").run(id, sessionId);
    return item;
  }

  remove(sessionId: string, id: string): boolean {
    const res = this.db.prepare("DELETE FROM session_queue WHERE id = ? AND session_id = ?").run(id, sessionId);
    return Number(res.changes) > 0;
  }

  clear(sessionId: string): void {
    this.db.prepare("DELETE FROM session_queue WHERE session_id = ?").run(sessionId);
  }

  /** Sessions that still have entries (used after a restart). */
  sessionsWithEntries(): string[] {
    return (this.db.prepare("SELECT DISTINCT session_id FROM session_queue").all() as { session_id: string }[]).map((r) => r.session_id);
  }
}

function toItem(row: QueueRow): QueuedPrompt {
  return {
    id: row.id,
    sessionId: row.session_id,
    text: row.text,
    ...(row.attachments ? { attachments: JSON.parse(row.attachments) as PromptAttachment[] } : {}),
    actor: row.actor,
    createdAt: row.created_at,
  };
}
