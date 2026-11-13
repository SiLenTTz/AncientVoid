import { useEffect, useState } from "preact/hooks";
import type { HubApi, QueuedPrompt } from "../../shared/api.ts";

/** EPIC-P15 T15.3: vorgemerkte Nachrichten — gehen der Reihe nach raus, sobald der Zug endet.
 * BUG-0114: zusätzlich je Eintrag sofort in den laufenden Zug sendbar. */
export function QueueList({ sessionId, api, refreshKey }: { sessionId: string; api: HubApi; refreshKey: number }) {
  const [items, setItems] = useState<QueuedPrompt[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .sessionQueue(sessionId)
        .then((list) => alive && setItems((prev) => (prev.length === list.length && prev.every((p, i) => p.id === list[i]!.id && p.delivery === list[i]!.delivery) ? prev : list)))
        .catch(() => undefined); // ein Fehlschlag lässt die Liste stehen (BUG-0045)
    void load();
    const timer = setInterval(load, 2500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [sessionId, api, refreshKey]);
  if (items.length === 0) return null;
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
  return (
    <div class="queue-list" aria-label="Vorgemerkt">
      <div class="queue-title dim">Vorgemerkt ({items.length}) — geht raus, sobald der Zug endet</div>
      {error && <div class="reply-error" role="alert">{error}</div>}
      {items.map((item, i) => (
        <div key={item.id} class="queue-item">
          <span class="queue-pos dim">{i + 1}.</span>
          <span class="queue-text">{item.text.length > 140 ? `${item.text.slice(0, 139)}…` : item.text}</span>
          {item.delivery === "unknown" && <span role="alert">Annahme unklar — Verlauf prüfen</span>}
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
          <button class="icon-action danger" type="button" aria-label={`Vorgemerkte Nachricht ${i + 1} streichen`} title="Streichen" onClick={() => remove(item)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
