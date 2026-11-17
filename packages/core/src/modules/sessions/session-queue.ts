import { randomUUID } from "node:crypto";
import type { PromptAttachment, QueueDeliveryState } from "@ancientvoid/contracts";
import type { HubDatabase } from "../../platform/index.ts";

/** EPIC-P15 T15.3: a prompt waiting for the running turn to end. */
export interface QueuedPrompt {
  delivery?: QueueDeliveryState;
  id: string;
  sessionId: string;
  text: string;
  attachments?: PromptAttachment[];
  actor: string | null;
  createdAt: string;
  /** ADR-0085: Stelle in der Warteschlange (niedrig = geht zuerst raus). */
  position: number;
}

interface QueueRow {
  id: string;
  session_id: string;
  text: string;
  attachments: string | null;
  actor: string | null;
  created_at: string;
  position: number;
}

/**
 * Persistent per-session prompt queue (K7: a hub restart keeps what was queued).
 * The manager takes the first entry when a turn ends; nothing here sends anything.
 * ADR-0085: Reihenfolge ist eine eigene Spalte (`position`) — der Nutzer kann umhaengen
 * und den Text nachtraeglich bearbeiten, solange der Prompt noch nicht unterwegs ist.
 */
export class SessionQueue {
  private readonly db: HubDatabase;

  constructor(db: HubDatabase) {
    this.db = db;
  }

  add(sessionId: string, text: string, attachments: PromptAttachment[] | undefined, actor: string | null): QueuedPrompt {
    // ADR-0085: neue Eintraege haengen sich hinten an; die Reihenfolge steht in der
    // `position`-Spalte, nicht mehr in der Ankunftszeit (die bleibt als Zeitstempel erhalten).
    const position = this.nextPosition(sessionId);
    const item: QueuedPrompt = {
      id: randomUUID(),
      sessionId,
      text,
      ...(attachments?.length ? { attachments } : {}),
      actor,
      createdAt: new Date().toISOString(),
      position,
    };
    this.db
      .prepare("INSERT INTO session_queue (id, session_id, text, attachments, actor, created_at, position) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(item.id, sessionId, text, item.attachments ? JSON.stringify(item.attachments) : null, actor, item.createdAt, position);
    return item;
  }

  private nextPosition(sessionId: string): number {
    const row = this.db.prepare("SELECT MAX(position) AS p FROM session_queue WHERE session_id = ?").get(sessionId) as { p: number | null };
    return (row?.p ?? -1) + 1;
  }

  list(sessionId: string): QueuedPrompt[] {
    const rows = this.db
      .prepare("SELECT * FROM session_queue WHERE session_id = ? ORDER BY position ASC, created_at ASC, id ASC")
      .all(sessionId) as unknown as QueueRow[];
    return rows.map(toItem);
  }

  /** ADR-0085: der Text eines vorgemerkten Prompts wird nachtraeglich geaendert. */
  updateText(sessionId: string, id: string, text: string): boolean {
    const res = this.db.prepare("UPDATE session_queue SET text = ? WHERE id = ? AND session_id = ?").run(text, id, sessionId);
    return Number(res.changes) > 0;
  }

  /**
   * ADR-0085: einen vorgemerkten Prompt umhaengen — "front" = der naechste, der rausgeht.
   * Zwei verschiebende UPDATEs: alle vor (bzw. nach) dem Eintrag ruecken einen Platz, dann
   * bekommt der Eintrag die frei gewordene Spitze. Lücken in der Nummerierung sind egal —
   * die Reihenfolge ist alles, und jeder Schritt fuer sich hinterlaesst eine geordnete Folge.
   */
  moveTo(sessionId: string, id: string, where: "front" | "back"): boolean {
    const rows = this.list(sessionId);
    const from = rows.findIndex((q) => q.id === id);
    if (from < 0) return false;
    const to = where === "front" ? 0 : rows.length - 1;
    if (from === to) return true; // schon an der Stelle
    const next = [...rows];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    // Positionen neu durchnummerieren statt verschieben: sonst wandern die Werte mit
    // jedem Umhaengen gegen unendlich (beobachtet im eigenen Test: -2, -1, 0).
    const write = this.db.prepare("UPDATE session_queue SET position = ? WHERE id = ? AND session_id = ?");
    this.db.prepare("BEGIN").run();
    try {
      next.forEach((q, i) => write.run(i, q.id, sessionId));
      this.db.prepare("COMMIT").run();
    } catch (err) {
      this.db.prepare("ROLLBACK").run();
      throw err;
    }
    return true;
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
    position: row.position,
  };
}
