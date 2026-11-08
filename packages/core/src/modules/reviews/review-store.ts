import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CreateReviewNoteInput, ReviewNote, ReviewNoteStatus } from "@ancientvoid/contracts";
import { REVIEW_NOTE_MAX_CHARS } from "@ancientvoid/contracts";

/**
 * EPIC-P36 / ADR-0055 §4: kanonischer Review-Zustand ist Journal + Snapshot
 * pro Session (`<dataDir>/<sessionId>/notes.jsonl` + `snapshot.json`), keine
 * SQLite-Insel. Jede Mutation hängt zuerst eine Journalzeile an (monotone
 * `seq`), mutiert dann den Speicher und schreibt den Snapshot atomar neu
 * (tmp + rename). Restore = Snapshot (`appliedSeq`) + Journal-Nachlauf;
 * kaputte Journalzeilen werden gezählt und übersprungen, nie versteckt (K7).
 */

type JournalEvent =
  | { seq: number; type: "note_created"; at: string; note: ReviewNote }
  | { seq: number; type: "note_updated"; at: string; id: string; text: string }
  | { seq: number; type: "note_deleted"; at: string; id: string }
  | {
      seq: number;
      type: "note_status";
      at: string;
      id: string;
      status: ReviewNoteStatus;
      sendDetail: string | null;
      sentAt: string | null;
      operationId: string | null;
    }
  | { seq: number; type: "review_sent"; at: string; operationId: string; noteIds: string[]; ok: boolean; detail: string | null };

interface Snapshot {
  appliedSeq: number;
  notes: ReviewNote[];
}

/** Sichtbares Recovery-Ergebnis — übersprungene Journalzeilen sind ein Befund. */
export interface ReviewRecoveryReport {
  sessionId: string;
  replayedEvents: number;
  skippedLines: number;
}

interface SessionState {
  notes: Map<string, ReviewNote>;
  seq: number;
  lastReport: ReviewRecoveryReport;
}

/** Fail-loud-Längengrenze — Routes prüfen per Zod, der Store doppelt nach. */
function assertNoteText(text: string): void {
  if (text.length > REVIEW_NOTE_MAX_CHARS) {
    throw new Error(`Notiztext übersteigt ${REVIEW_NOTE_MAX_CHARS} Zeichen.`);
  }
}

export class ReviewStore {
  private readonly root: string;
  private readonly sessions = new Map<string, SessionState>();

  constructor(root: string) {
    this.root = root;
  }

  /** Journal + Snapshot einer Session laden (idempotent, einmal pro Prozess). */
  private load(sessionId: string): SessionState {
    const cached = this.sessions.get(sessionId);
    if (cached) return cached;

    const dir = resolve(this.root, sessionId);
    const journalPath = resolve(dir, "notes.jsonl");
    let snapshot: Snapshot = { appliedSeq: 0, notes: [] };
    if (existsSync(resolve(dir, "snapshot.json"))) {
      try {
        const parsed = JSON.parse(readFileSync(resolve(dir, "snapshot.json"), "utf8")) as Snapshot;
        if (Array.isArray(parsed.notes) && typeof parsed.appliedSeq === "number") snapshot = parsed;
      } catch {
        // kaputter Snapshot → ehrlich komplett aus dem Journal rekonstruieren
        snapshot = { appliedSeq: 0, notes: [] };
      }
    }
    const notes = new Map<string, ReviewNote>(snapshot.notes.map((n) => [n.id, n]));
    let seq = snapshot.appliedSeq;
    let replayed = 0;
    let skipped = 0;
    if (existsSync(journalPath)) {
      for (const line of readFileSync(journalPath, "utf8").split("\n")) {
        if (!line.trim()) continue;
        let event: JournalEvent;
        try {
          event = JSON.parse(line) as JournalEvent;
        } catch {
          skipped += 1;
          continue;
        }
        if (typeof event.seq !== "number" || event.seq <= snapshot.appliedSeq) continue;
        this.apply(notes, event);
        seq = Math.max(seq, event.seq);
        replayed += 1;
      }
    }
    const state: SessionState = { notes, seq, lastReport: { sessionId, replayedEvents: replayed, skippedLines: skipped } };
    this.sessions.set(sessionId, state);
    return state;
  }

  /** Ein Event auf den Zustand anwenden — reine Faltung, für Journal-Replay und Mutation. */
  private apply(notes: Map<string, ReviewNote>, event: JournalEvent): void {
    switch (event.type) {
      case "note_created":
        notes.set(event.note.id, event.note);
        break;
      case "note_updated": {
        const note = notes.get(event.id);
        if (note) notes.set(event.id, { ...note, text: event.text, updatedAt: event.at });
        break;
      }
      case "note_deleted":
        notes.delete(event.id);
        break;
      case "note_status": {
        const note = notes.get(event.id);
        if (note) {
          notes.set(event.id, {
            ...note,
            status: event.status,
            updatedAt: event.at,
            sendDetail: event.sendDetail,
            sentAt: event.sentAt,
            operationId: event.operationId,
          });
        }
        break;
      }
      case "review_sent":
        // Nur Metadaten je Note (unten, via markSent); das Ereignis selbst
        // braucht keine Faltung — der Versand-Bericht steht im Journal.
        break;
    }
  }

  private commit(sessionId: string, state: SessionState, event: JournalEvent): void {
    const dir = resolve(this.root, sessionId);
    mkdirSync(dir, { recursive: true });
    state.seq += 1;
    const withSeq = { ...event, seq: state.seq } as JournalEvent;
    this.apply(state.notes, withSeq);
    writeFileSync(resolve(dir, "notes.jsonl"), JSON.stringify(withSeq) + "\n", { flag: "a" });
    const snapshot: Snapshot = { appliedSeq: state.seq, notes: [...state.notes.values()] };
    const tmp = resolve(dir, "snapshot.json.tmp");
    writeFileSync(tmp, JSON.stringify(snapshot));
    renameSync(tmp, resolve(dir, "snapshot.json"));
  }

  list(sessionId: string): ReviewNote[] {
    return [...this.load(sessionId).notes.values()].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  }

  get(sessionId: string, id: string): ReviewNote | undefined {
    return this.load(sessionId).notes.get(id);
  }

  recoveryReport(sessionId: string): ReviewRecoveryReport {
    return this.load(sessionId).lastReport;
  }

  create(sessionId: string, input: CreateReviewNoteInput): ReviewNote {
    assertNoteText(input.text);
    const state = this.load(sessionId);
    const now = new Date().toISOString();
    const note: ReviewNote = {
      id: randomUUID(),
      sessionId,
      basis: { ...input.basis, headSha: input.basis.headSha ?? null },
      anchor: input.anchor,
      text: input.text,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      sentAt: null,
      operationId: null,
      sendDetail: null,
    };
    this.commit(sessionId, state, { seq: 0, type: "note_created", at: now, note });
    return note;
  }

  updateText(sessionId: string, id: string, text: string): ReviewNote | null {
    assertNoteText(text);
    const state = this.load(sessionId);
    if (!state.notes.has(id)) return null;
    const updated: ReviewNote = { ...state.notes.get(id)!, text, updatedAt: new Date().toISOString() };
    this.commit(sessionId, state, { seq: 0, type: "note_updated", at: updated.updatedAt, id, text });
    return updated;
  }

  delete(sessionId: string, id: string): boolean {
    const state = this.load(sessionId);
    if (!state.notes.has(id)) return false;
    this.commit(sessionId, state, { seq: 0, type: "note_deleted", at: new Date().toISOString(), id });
    return true;
  }

  /** Menschliche Statussetzung oder Versandergebnis (Statusfaltung, ADR-0055 §7). */
  setStatus(
    sessionId: string,
    id: string,
    status: ReviewNoteStatus,
    patch: { sendDetail?: string | null; sentAt?: string | null; operationId?: string | null } = {},
  ): ReviewNote | null {
    const state = this.load(sessionId);
    const note = state.notes.get(id);
    if (!note) return null;
    this.commit(sessionId, state, {
      seq: 0,
      type: "note_status",
      at: new Date().toISOString(),
      id,
      status,
      sendDetail: patch.sendDetail !== undefined ? patch.sendDetail : note.sendDetail,
      sentAt: patch.sentAt !== undefined ? patch.sentAt : note.sentAt,
      operationId: patch.operationId !== undefined ? patch.operationId : note.operationId,
    });
    return state.notes.get(id) ?? null;
  }

  /** Sammelversand protokollieren; bei ok werden die Notizen gefaltet (draft → sent). */
  recordSend(
    sessionId: string,
    entry: { operationId: string; noteIds: string[]; ok: boolean; detail: string | null },
  ): void {
    const state = this.load(sessionId);
    this.commit(sessionId, state, {
      seq: 0,
      type: "review_sent",
      at: new Date().toISOString(),
      operationId: entry.operationId,
      noteIds: entry.noteIds,
      ok: entry.ok,
      detail: entry.detail,
    });
    const sentAt = new Date().toISOString();
    for (const id of entry.noteIds) {
      const note = state.notes.get(id);
      if (!note) continue;
      if (entry.ok) {
        // Bereits gesendete Notizen (Dedupe-Fall „duplicate input ignored")
        // behalten ihren ersten Zeitstempel — kein zweiter Sammelauftrag.
        if (note.status === "draft") {
          this.commit(sessionId, state, {
            seq: 0,
            type: "note_status",
            at: sentAt,
            id,
            status: "sent",
            sendDetail: null,
            sentAt,
            operationId: entry.operationId,
          });
        }
      } else {
        this.commit(sessionId, state, {
          seq: 0,
          type: "note_status",
          at: sentAt,
          id,
          status: note.status === "draft" ? "draft" : note.status,
          sendDetail: entry.detail,
          sentAt: note.sentAt,
          operationId: note.operationId,
        });
      }
    }
  }

  /** Test-/Diagnose-Hook: Speicherzustand verwerfen (nächstes load() liest neu). */
  reloadForTest(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
