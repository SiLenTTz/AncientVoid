import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { useApi } from "../../shared/api-context.ts";
import {
  newInputId,
  type ReviewNoteStatus,
  type ReviewNoteView,
  type SessionDiffResult,
  type SessionRecord,
} from "../../shared/api.ts";
import { DiffPane, type LinePick, type ReviewHooks } from "./DiffPane.tsx";
import { mapHunkLines } from "./diff-lines.ts";

/**
 * EPIC-P36 / ADR-0055: Review-Notizen um die bestehende Diff-Ansicht.
 * DiffPane bleibt Renderer; diese Komponente hält Auswahl, Notizen,
 * Offline-Outbox (sichtbarer Zeitstempel) und den Sammelversand über die
 * vorhandene Steer-Pipeline (Operations-ID gegen Doppelversand).
 */

interface OutboxEntry {
  id: string;
  kind: "create" | "update" | "delete" | "status";
  noteId?: string;
  body?: { basis: { baseRef: string; scope: { kind: "commit"; sha: string } | { kind: "uncommitted" } }; anchor: ReviewNoteView["anchor"]; text: string };
  text?: string;
  status?: ReviewNoteStatus;
  queuedAt: string;
}

const outboxKey = (sessionId: string) => `av-review-outbox-${sessionId}`;
const EXCERPT_MAX = 400;

function readOutbox(sessionId: string): OutboxEntry[] {
  try {
    return JSON.parse(localStorage.getItem(outboxKey(sessionId)) ?? "[]") as OutboxEntry[];
  } catch {
    return [];
  }
}

function writeOutbox(sessionId: string, entries: OutboxEntry[]): void {
  localStorage.setItem(outboxKey(sessionId), JSON.stringify(entries));
}

const statusLabel: Record<ReviewNoteStatus, string> = { draft: "Entwurf", sent: "gesendet", open: "offen", done: "erledigt" };

const sideLabel = (side: "old" | "new") => (side === "old" ? "alte" : "neue");

export function DiffReview({ diff, session }: { diff: SessionDiffResult | null; session: SessionRecord }) {
  const api = useApi();
  const [notes, setNotes] = useState<ReviewNoteView[]>([]);
  const [skippedLines, setSkippedLines] = useState(0);
  const [pickEnabled, setPickEnabled] = useState(false);
  const [picked, setPicked] = useState<ReviewHooks["picked"]>(null);
  const [pendingText, setPendingText] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sendOpen, setSendOpen] = useState(false);
  const [sendPreview, setSendPreview] = useState<string | null>(null);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [operationId] = useState(() => newInputId());
  const [targetSessionId, setTargetSessionId] = useState<string>(session.id);
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null);
  const [outbox, setOutbox] = useState<OutboxEntry[]>(() => readOutbox(session.id));
  const [error, setError] = useState<string | null>(null);
  const online = typeof navigator === "undefined" ? true : navigator.onLine;

  const refresh = useCallback(async () => {
    try {
      const res = await api.sessionReviews(session.id);
      setNotes(res.items);
      setSkippedLines(res.journalSkippedLines ?? 0);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Notizen nicht erreichbar");
    }
  }, [api, session.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** EPIC-P36: Ändert sich der Diff (Tab-Wechsel/Neuladen), werden die Anker
   * aller Notizen gegen den neuen Stand bewertet — veraltete bleiben sichtbar. */
  useEffect(() => {
    if (diff !== null) void refresh();
  }, [diff, refresh]);

  /** Offline-geparkte Mutationen nachziehen — mit Zeitstempel sichtbar. */
  const flushOutbox = useCallback(async () => {
    if (!navigator.onLine) return;
    const entries = readOutbox(session.id);
    const remaining: OutboxEntry[] = [];
    for (const entry of entries) {
      try {
        if (entry.kind === "create" && entry.body) await api.createReviewNote(session.id, entry.body);
        else if (entry.kind === "update" && entry.noteId && entry.text !== undefined) await api.updateReviewNote(session.id, entry.noteId, entry.text);
        else if (entry.kind === "delete" && entry.noteId) await api.deleteReviewNote(session.id, entry.noteId);
        else if (entry.kind === "status" && entry.noteId && entry.status) await api.setReviewNoteStatus(session.id, entry.noteId, entry.status);
      } catch {
        remaining.push(entry); // nächster Versuch, Eintrag bleibt sichtbar
      }
    }
    writeOutbox(session.id, remaining);
    setOutbox(remaining);
    if (entries.length !== remaining.length) void refresh();
  }, [api, refresh, session.id]);

  useEffect(() => {
    void flushOutbox();
    const onOnline = () => void flushOutbox();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [flushOutbox]);

  const enqueue = (entry: Omit<OutboxEntry, "id" | "queuedAt">): void => {
    const full: OutboxEntry = { ...entry, id: newInputId(), queuedAt: new Date().toISOString() };
    const next = [...readOutbox(session.id), full];
    writeOutbox(session.id, next);
    setOutbox(next);
  };

  const mutate = async (run: () => Promise<unknown>, fallback: Omit<OutboxEntry, "id" | "queuedAt">): Promise<void> => {
    try {
      await run();
      await refresh();
    } catch (err) {
      if (err instanceof TypeError || !navigator.onLine) {
        // Netzwerkfehler/Offline: Entwurf bleibt lokal mit Zeitstempel (AC-P36-5)
        enqueue(fallback);
      } else {
        setError(err instanceof Error ? err.message : "Aktion fehlgeschlagen");
      }
    }
  };

  const onLinePick = (pick: LinePick): void => {
    if (!picked || picked.path !== pick.path || picked.commit !== pick.commit) {
      setPicked({ path: pick.path, commit: pick.commit, side: pick.side, start: pick.line, end: pick.line });
      return;
    }
    // zweiter Tipp in derselben Datei → Bereich erweitern/ersetzen
    setPicked({
      path: pick.path,
      commit: pick.commit,
      side: pick.side,
      start: Math.min(picked.start, pick.line),
      end: Math.max(picked.end, pick.line),
    });
  };

  const scopeOfPicked = useMemo<ReviewNoteView["basis"]["scope"] | null>(() => {
    if (!picked) return null;
    return picked.commit ? { kind: "commit", sha: picked.commit } : { kind: "uncommitted" };
  }, [picked]);

  const createNote = (): void => {
    if (!picked || !scopeOfPicked || !diff || !pendingText.trim()) return;
    const excerpt = (pickedExcerpt(diff, picked) ?? "").slice(0, EXCERPT_MAX);
    const body = {
      basis: { baseRef: diff.baseRef, scope: scopeOfPicked },
      anchor: { path: picked.path, side: picked.side, startLine: picked.start, endLine: picked.end, excerpt },
      text: pendingText.trim(),
    };
    void mutate(() => api.createReviewNote(session.id, body), { kind: "create", body });
    setPendingText("");
    setPicked(null);
    setPickEnabled(false);
  };

  const noteCount = useCallback((path: string) => notes.filter((n) => n.anchor.path === path).length, [notes]);

  const sendable = useMemo(() => notes.filter((n) => n.status === "draft" && n.anchorState !== "stale"), [notes]);
  const selectedNotes = useMemo(() => sendable.filter((n) => selected.has(n.id)), [sendable, selected]);

  const openSend = async (): Promise<void> => {
    setSendOpen(true);
    setSendError(null);
    setSendPreview(null);
    try {
      const [preview, list] = await Promise.all([api.previewReviewFeedback(session.id, [...selected]), api.sessions()]);
      setSendPreview(preview.prompt);
      setSessions(list);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Vorschau fehlgeschlagen");
    }
  };

  const send = async (): Promise<void> => {
    if (!navigator.onLine) {
      setSendError("Offline — Versand erst mit Verbindung.");
      return;
    }
    setSendBusy(true);
    setSendError(null);
    try {
      const res = await api.sendReviewFeedback(session.id, {
        noteIds: [...selected],
        targetSessionId: targetSessionId === session.id ? undefined : targetSessionId,
        operationId,
      });
      if (res.ok) {
        setSendOpen(false);
        setSelected(new Set());
        await refresh();
      } else {
        // Ursache sichtbar; dieselbe Operations-ID macht Retry sicher (AC-P36-2/5)
        setSendError(res.detail ?? "Versand abgelehnt");
        await refresh();
      }
    } catch {
      setSendError("Zustellung unklar (Netzwerk) — erneuter Versuch mit derselben Operations-ID ist sicher.");
    } finally {
      setSendBusy(false);
    }
  };

  const hooks: ReviewHooks = { pickEnabled, picked, onLinePick: pickEnabled ? onLinePick : undefined, noteCount };
  const targetLabel = sessions?.find((s) => s.id === targetSessionId);

  return (
    <div class="diff-review">
      <div class="diff-review-toolbar">
        <button class={pickEnabled ? "review-pick-btn active" : "review-pick-btn"} onClick={() => { setPickEnabled(!pickEnabled); setPicked(null); }}>
          {pickEnabled ? "Anker wählen (Zeile antippen)" : "Notiz an Zeilen"}
        </button>
        {picked && (
          <span class="review-picked-info mono">
            {picked.path} · {sideLabel(picked.side)} {picked.start === picked.end ? `Zeile ${picked.start}` : `Zeilen ${picked.start}–${picked.end}`}
            {picked.commit ? ` · Commit ${picked.commit.slice(0, 8)}` : " · uncommittet"}
          </span>
        )}
        {picked && (
          <span class="review-note-entry">
            <input
              type="text"
              placeholder="Befund notieren …"
              value={pendingText}
              maxLength={4000}
              onInput={(e) => setPendingText((e.target as HTMLInputElement).value)}
            />
            <button class="review-save-btn" disabled={!pendingText.trim()} onClick={createNote}>
              speichern
            </button>
          </span>
        )}
      </div>

      <DiffPane diff={diff} sessionId={session.id} review={hooks} />

      <section class="review-panel">
        <h3>
          Review-Notizen <span class="dim">({notes.length})</span>
        </h3>
        {skippedLines > 0 && <div class="review-warn">Journal enthält {skippedLines} unlesbare Zeile(n) — Recovery-Report im Hub.</div>}
        {error && <div class="review-warn">{error}</div>}
        {!online && <div class="review-warn">Offline — Änderungen werden lokal gehalten und mit Zeitstempel nachgezogen; Versand gesperrt.</div>}

        {outbox.map((entry) => (
          <div key={entry.id} class="review-note outboxed">
            <span class="review-status draft">lokal · {new Date(entry.queuedAt).toLocaleTimeString("de-DE")}</span>
            <span class="dim">noch nicht gesendet</span>
          </div>
        ))}

        {notes.map((note) => (
          <div key={note.id} class={`review-note ${note.anchorState === "stale" ? "stale" : ""}`}>
            <label class="review-note-select">
              <input
                type="checkbox"
                disabled={!sendable.some((s) => s.id === note.id)}
                checked={selected.has(note.id)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if ((e.target as HTMLInputElement).checked) next.add(note.id);
                  else next.delete(note.id);
                  setSelected(next);
                }}
              />
            </label>
            <div class="review-note-body">
              <div class="mono review-note-ref">
                {note.anchor.path} · {sideLabel(note.anchor.side)} {note.anchor.startLine === note.anchor.endLine ? `Zeile ${note.anchor.startLine}` : `Zeilen ${note.anchor.startLine}–${note.anchor.endLine}`}
                {note.basis.scope.kind === "commit" ? ` · Commit ${note.basis.scope.sha.slice(0, 8)}` : " · uncommittet"}
              </div>
              <div class="review-note-text">{note.text}</div>
              <div class="review-note-meta">
                <span class={`review-status ${note.status}`}>{statusLabel[note.status]}</span>
                {note.anchorState === "stale" && <span class="review-stale-badge" title={note.staleReason ?? ""}>veraltet: {note.staleReason}</span>}
                {note.anchorState === "unclear" && <span class="review-unclear-badge" title={note.staleReason ?? ""}>Anker unklar: {note.staleReason}</span>}
                {note.sendDetail && <span class="review-warn-inline">{note.sendDetail}</span>}
                {note.sentAt && <span class="dim">gesendet {new Date(note.sentAt).toLocaleString("de-DE")}</span>}
              </div>
            </div>
            <div class="review-note-actions">
              {(note.status === "sent" || note.status === "draft") && (
                <button onClick={() => void mutate(() => api.setReviewNoteStatus(session.id, note.id, "open"), { kind: "status", noteId: note.id, status: "open" })}>offen</button>
              )}
              {note.status !== "done" && (
                <button onClick={() => void mutate(() => api.setReviewNoteStatus(session.id, note.id, "done"), { kind: "status", noteId: note.id, status: "done" })}>erledigt</button>
              )}
              <button
                onClick={() => {
                  const text = window.prompt("Notiz bearbeiten", note.text);
                  if (text && text.trim()) void mutate(() => api.updateReviewNote(session.id, note.id, text.trim()), { kind: "update", noteId: note.id, text: text.trim() });
                }}
              >
                bearbeiten
              </button>
              <button onClick={() => void mutate(() => api.deleteReviewNote(session.id, note.id), { kind: "delete", noteId: note.id })}>löschen</button>
            </div>
          </div>
        ))}

        <div class="review-send-bar">
          <button class="review-send-btn" disabled={selectedNotes.length === 0 || !online} onClick={() => void openSend()}>
            {selectedNotes.length > 0 ? `${selectedNotes.length} ${selectedNotes.length === 1 ? "Befund" : "Befunde"} sammeln und senden` : "Befunde zum Versand auswählen"}
          </button>
          {!online && <span class="review-warn-inline">Versand nur online</span>}
        </div>
      </section>

      {sendOpen && (
        <div class="modal review-send-dialog" role="dialog" aria-label="Sammelversand">
          <div class="modal-card">
            <h3>Sammelversand ({selectedNotes.length} Befunde)</h3>
            <label class="review-recipient">
              Empfänger
              <select value={targetSessionId} onChange={(e) => setTargetSessionId((e.target as HTMLSelectElement).value)}>
                <option value={session.id}>{session.title ?? session.id.slice(0, 8)} · {session.adapter} (diese Session)</option>
                {sessions
                  ?.filter((s) => s.id !== session.id)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title ?? s.id.slice(0, 8)} · {s.adapter}
                    </option>
                  ))}
              </select>
            </label>
            <pre class="review-prompt-preview mono">{sendPreview ?? "Vorschau lädt …"}</pre>
            {sendError && <div class="review-warn">{sendError}</div>}
            <div class="modal-actions">
              <button onClick={() => setSendOpen(false)}>abbrechen</button>
              <button class="review-send-btn" disabled={sendBusy || !sendPreview} onClick={() => void send()}>
                {sendBusy ? "sendet …" : `an ${targetLabel?.title?.slice(0, 24) ?? targetSessionId.slice(0, 8)} senden`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Ausschnitt um den Anker aus dem aktuellen Diff — echte Seiten-Nummern,
 * derselben Logik folgend, die der Hub beim Wiedervorlagen prüft. */
function pickedExcerpt(diff: SessionDiffResult, picked: NonNullable<ReviewHooks["picked"]>): string | null {
  const files = picked.commit ? (diff.commits.find((c) => c.sha === picked.commit)?.files ?? []) : diff.files;
  const file = files.find((f) => f.path === picked.path);
  if (!file) return null;
  const texts: string[] = [];
  for (const hunk of file.hunks) {
    for (const line of mapHunkLines(hunk)) {
      const n = picked.side === "old" ? line.oldLine : line.newLine;
      if (n !== null && n >= picked.start && n <= picked.end) texts.push(line.text);
    }
  }
  return texts.length > 0 ? texts.join("\n") : null;
}
