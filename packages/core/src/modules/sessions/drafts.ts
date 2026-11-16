import type { SaveDraftInput, SessionDraft } from "@ancientvoid/contracts";
import type { HubDatabase } from "../../platform/index.ts";

interface DraftRow {
  session_id: string;
  text: string;
  attachment_ids: string;
  revision: number;
  updated_at: string;
  device: string | null;
}

export type SaveDraftResult = { ok: true; draft: SessionDraft } | { ok: false; conflict: SessionDraft };

/**
 * T8.4 / ADR-0025: drafts with optimistic concurrency. Saving from an old
 * revision is a conflict and returns what is stored — the device decides,
 * nothing is overwritten silently. An empty save deletes the draft.
 */
export class DraftStore {
  private readonly db: HubDatabase;

  constructor(db: HubDatabase) {
    this.db = db;
  }

  get(sessionId: string): SessionDraft {
    const row = this.db.prepare("SELECT * FROM drafts WHERE session_id = ?").get(sessionId) as unknown as DraftRow | undefined;
    if (!row) return { sessionId, text: "", attachmentIds: [], revision: 0, updatedAt: null, device: null };
    return { sessionId, text: row.text, attachmentIds: JSON.parse(row.attachment_ids) as string[], revision: row.revision, updatedAt: row.updated_at, device: row.device };
  }

  save(sessionId: string, input: SaveDraftInput, device: string | null): SaveDraftResult {
    const current = this.get(sessionId);
    if (input.baseRevision !== current.revision) {
      // Same content from two devices is no conflict.
      if (input.text === current.text && JSON.stringify(input.attachmentIds) === JSON.stringify(current.attachmentIds)) return { ok: true, draft: current };
      return { ok: false, conflict: current };
    }
    const revision = current.revision + 1;
    const now = new Date().toISOString();
    if (!input.text && input.attachmentIds.length === 0) {
      // Keep the row so the revision keeps counting (a stale device still conflicts).
      this.db
        .prepare("INSERT INTO drafts (session_id, text, attachment_ids, revision, updated_at, device) VALUES (?, '', '[]', ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET text = '', attachment_ids = '[]', revision = excluded.revision, updated_at = excluded.updated_at, device = excluded.device")
        .run(sessionId, revision, now, device);
    } else {
      this.db
        .prepare("INSERT INTO drafts (session_id, text, attachment_ids, revision, updated_at, device) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET text = excluded.text, attachment_ids = excluded.attachment_ids, revision = excluded.revision, updated_at = excluded.updated_at, device = excluded.device")
        .run(sessionId, input.text, JSON.stringify(input.attachmentIds), revision, now, device);
    }
    return { ok: true, draft: this.get(sessionId) };
  }
}
