import { useEffect, useState } from "preact/hooks";
import type { HubApi, QueuedPrompt } from "../../shared/api.ts";

/**
 * EPIC-P15 T15.3: vorgemerkte Nachrichten — gehen der Reihe nach raus, sobald der Zug endet.
 * BUG-0114: zusätzlich je Eintrag sofort in den laufenden Zug sendbar.
 * ADR-0085: derselbe Eintrag lässt sich nachträglich umhängen (↑/↓ — "der Nächste" sein) und
 * in seinem Text ändern, solange er noch nicht unterwegs ist. Beides wirkt auf die Reihe,
 * wie sie der Hub hält; die Liste hier ist Ansicht, nicht Entscheidung.
 */
export function QueueList({ sessionId, api, refreshKey }: { sessionId: string; api: HubApi; refreshKey: number }) {
  const [items, setItems] = useState<QueuedPrompt[]>([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .sessionQueue(sessionId)
        .then((list) =>
          alive &&
          setItems((prev) =>
            prev.length === list.length && prev.every((p, i) => p.id === list[i]!.id && p.delivery === list[i]!.delivery) ? prev : list,
          ),
        )
        .catch(() => undefined); // ein Fehlschlag lässt die Liste stehen (BUG-0045)
    void load();
    const timer = setInterval(load, 2500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [sessionId, api, refreshKey]);
  if (items.length === 0) return null;
  const sorted = [...items].sort((a, b) => a.position - b.position);
  const replace = (list: QueuedPrompt[]) => setItems(list);
  const remove = (item: QueuedPrompt) => {
    setError("");
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    void api.removeQueued(sessionId, item.id).catch((err: unknown) => {
      // 404 = schon weg (gesendet oder anderswo gestrichen) — alles andere ehrlich zurückstellen.
      if ((err as { status?: unknown })?.status === 404) return;
      setItems((prev) => (prev.some((i) => i.id === item.id) ? prev : [...prev, item].sort((a, b) => a.createdAt.localeCompare(b.createdAt))));
      setError("Streichen fehlgeschlagen — die Nachricht bleibt vorgemerkt.");
    });
  };
  const sendNow = (item: QueuedPrompt) => {
    setError("");
    void api
      .sendQueuedNow(sessionId, item.id)
      .then(() => setItems((prev) => prev.filter((i) => i.id !== item.id)))
      // 422 trägt den Ablehnungsgrund (Error-Message); der Hub hat die Nachricht dann wieder vorgemerkt.
      .catch((err) =>
        setError(`${err instanceof Error && err.message && !/^\d/.test(err.message) ? err.message : "Senden fehlgeschlagen"} — die Nachricht bleibt vorgemerkt.`),
      );
  };
  /** ADR-0085: umhängen. Optimistisch, damit die Reihe sofort der gewählten folgt. */
  const move = (item: QueuedPrompt, where: "front" | "back") => {
    setError("");
    const idx = sorted.findIndex((q) => q.id === item.id);
    const to = where === "front" ? 0 : sorted.length - 1;
    if (idx === to) return;
    const next = [...sorted];
    next.splice(idx, 1);
    next.splice(to, 0, item);
    replace(next.map((q, i) => ({ ...q, position: i })));
    void api.editQueued(sessionId, item.id, { move: where }).catch(() => {
      setError("Umhängen fehlgeschlagen — die Reihe bleibt, wie sie war.");
      void api.sessionQueue(sessionId).then((list) => replace(list)).catch(() => undefined);
    });
  };
  /** ADR-0085: Text nachträglich ändern. */
  const saveEdit = () => {
    if (!editing) return;
    const text = editing.text.trim();
    const original = items.find((q) => q.id === editing.id);
    setEditing(null);
    if (!original || text === "" || text === original.text) return;
    setError("");
    replace(items.map((q) => (q.id === editing.id ? { ...q, text } : q)));
    void api.editQueued(sessionId, editing.id, { text }).catch(() => {
      setError("Ändern fehlgeschlagen — die Nachricht bleibt, wie sie vorgemerkt war.");
      void api.sessionQueue(sessionId).then((list) => replace(list)).catch(() => undefined);
    });
  };
  return (
    <div class="queue-list" aria-label="Vorgemerkt">
      <div class="queue-title dim">Vorgemerkt ({sorted.length}) — geht raus, sobald der Zug endet</div>
      {error && <div class="reply-error" role="alert">{error}</div>}
      {sorted.map((item, i) => (
        <div key={item.id} class="queue-item">
          <span class="queue-pos dim">{i + 1}.</span>
          {editing?.id === item.id ? (
            <div class="queue-edit">
              <textarea
                class="queue-edit-input"
                aria-label={`Vorgemerkte Nachricht ${i + 1} bearbeiten`}
                value={editing.text}
                rows={3}
                onInput={(e) => setEditing({ id: item.id, text: (e.target as HTMLTextAreaElement).value })}
              />
              <div class="queue-edit-actions">
                <button class="btn primary" type="button" data-testid="queue-edit-save" onClick={saveEdit}>
                  Speichern
                </button>
                <button class="btn" type="button" onClick={() => setEditing(null)}>
                  Abbrechen
                </button>
              </div>
            </div>
          ) : (
            <>
              <span class="queue-text">{item.text.length > 140 ? `${item.text.slice(0, 139)}…` : item.text}</span>
              {item.delivery === "unknown" && <span role="alert">Annahme unklar — Verlauf prüfen</span>}
              {/* ADR-0085 + eigener Review: die Knöpfe unter dem Text — sonst bleibt auf
                  dem Handy (390 px) nur eine fünfzehn Zeichen lange Textspur übrig. */}
              <span class="queue-actions">
                <button
                  disabled={item.delivery === "unknown"}
                  class="icon-action"
                  type="button"
                  aria-label={`Vorgemerkte Nachricht ${i + 1} jetzt senden`}
                title="Jetzt in den laufenden Zug senden"
                onClick={() => sendNow(item)}
              >
                ➤
              </button>
              {/* ADR-0085: der Nächste in der Reihe werden — oder zurückfallen. */}
              <button
                disabled={i === 0 || item.delivery === "unknown"}
                class="icon-action"
                type="button"
                data-testid="queue-move-front"
                aria-label={`Vorgemerkte Nachricht ${i + 1} als nächstes senden`}
                title="Als nächstes senden"
                onClick={() => move(item, "front")}
              >
                ↑
              </button>
              <button
                disabled={i === sorted.length - 1 || item.delivery === "unknown"}
                class="icon-action"
                type="button"
                data-testid="queue-move-back"
                aria-label={`Vorgemerkte Nachricht ${i + 1} nach hinten setzen`}
                title="Nach hinten"
                onClick={() => move(item, "back")}
              >
                ↓
              </button>
              <button
                disabled={item.delivery === "unknown"}
                class="icon-action"
                type="button"
                data-testid="queue-edit"
                aria-label={`Vorgemerkte Nachricht ${i + 1} bearbeiten`}
                title="Text bearbeiten"
                onClick={() => setEditing({ id: item.id, text: item.text })}
              >
                ✎
              </button>
              <button class="icon-action danger" type="button" aria-label={`Vorgemerkte Nachricht ${i + 1} streichen`} title="Streichen" onClick={() => remove(item)}>
                ✕
              </button>
              </span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
