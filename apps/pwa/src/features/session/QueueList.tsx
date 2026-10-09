import { useEffect, useState } from "preact/hooks";
import type { HubApi, QueuedPrompt } from "../../shared/api.ts";

/** EPIC-P15 T15.3: vorgemerkte Nachrichten — gehen der Reihe nach raus, sobald der Zug endet. */
export function QueueList({ sessionId, api, refreshKey }: { sessionId: string; api: HubApi; refreshKey: number }) {
  const [items, setItems] = useState<QueuedPrompt[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .sessionQueue(sessionId)
        .then((list) => alive && setItems((prev) => (prev.length === list.length && prev.every((p, i) => p.id === list[i]!.id) ? prev : list)))
        .catch(() => undefined); // ein Fehlschlag lässt die Liste stehen (BUG-0045)
    void load();
    const timer = setInterval(load, 2500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [sessionId, api, refreshKey]);
  if (items.length === 0) return null;
  const remove = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    void api.removeQueued(sessionId, id).catch(() => undefined);
  };
  return (
    <div class="queue-list" aria-label="Vorgemerkt">
      <div class="queue-title dim">Vorgemerkt ({items.length}) — geht raus, sobald der Zug endet</div>
      {items.map((item, i) => (
        <div key={item.id} class="queue-item">
          <span class="queue-pos dim">{i + 1}.</span>
          <span class="queue-text">{item.text.length > 140 ? `${item.text.slice(0, 139)}…` : item.text}</span>
          <button class="link-btn" type="button" aria-label={`Vorgemerkte Nachricht ${i + 1} streichen`} onClick={() => remove(item.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
