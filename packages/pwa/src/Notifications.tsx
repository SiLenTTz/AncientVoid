import { useEffect, useRef, useState } from "preact/hooks";
import { hubApi, type HubNotification } from "./api.ts";
import { sessionHash } from "./route.ts";

const READ_KEY = "uacc.notifications.readUpTo";
const POLL_MS = 4000;
/** Errors stay longer — they usually need an action. */
const TOAST_MS: Record<HubNotification["level"], number> = { error: 12_000, warning: 8000, success: 5000, info: 5000 };

interface Toast {
  key: string;
  level: HubNotification["level"];
  title: string;
  detail: string | null;
  sessionId: string | null;
}

function readUpTo(): number {
  return Number(localStorage.getItem(READ_KEY) ?? 0) || 0;
}

export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "gerade eben";
  if (seconds < 3600) return `vor ${Math.floor(seconds / 60)} min`;
  if (seconds < 86_400) return `vor ${Math.floor(seconds / 3600)} h`;
  return new Date(iso).toLocaleDateString("de-DE");
}

/**
 * ADR-0015: toasts top right for new errors and status changes, plus a bell
 * with the recent list. Polls the hub; the first load only fills the list,
 * so opening the app never replays old toasts.
 */
export function NotificationCenter() {
  const [items, setItems] = useState<HubNotification[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState(readUpTo);
  const lastId = useRef<number | null>(null);
  const failures = useRef(0);

  const toast = (t: Toast) => {
    setToasts((prev) => [t, ...prev].slice(0, 4));
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.key !== t.key)), TOAST_MS[t.level]);
  };

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const page = await hubApi.notifications(lastId.current ?? 0);
        if (!alive) return;
        if (failures.current >= 2) toast({ key: `hub-${Date.now()}`, level: "success", title: "Verbindung zum Hub wieder da", detail: null, sessionId: null });
        failures.current = 0;
        if (lastId.current !== null) for (const n of [...page.items].reverse()) toast({ key: `n-${n.id}`, level: n.level, title: n.title, detail: n.detail, sessionId: n.sessionId });
        if (page.items.length > 0) setItems((prev) => [...page.items, ...prev].slice(0, 100));
        lastId.current = Math.max(lastId.current ?? 0, page.lastId);
      } catch {
        if (!alive) return;
        failures.current += 1;
        if (failures.current === 2) {
          toast({ key: `hub-${Date.now()}`, level: "warning", title: "Hub nicht erreichbar", detail: "Neue Meldungen kommen, sobald er wieder antwortet.", sessionId: null });
        }
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const unread = items.filter((n) => n.id > read).length;

  const openPanel = () => {
    setOpen((was) => !was);
    const top = items[0]?.id ?? 0;
    if (top > read) {
      localStorage.setItem(READ_KEY, String(top));
      setRead(top);
    }
  };

  const goTo = (sessionId: string | null) => {
    setOpen(false);
    if (sessionId) location.hash = sessionHash(sessionId);
  };

  return (
    <>
      <button
        class="notif-bell"
        type="button"
        aria-label={unread > 0 ? `Benachrichtigungen (${unread} neu)` : "Benachrichtigungen"}
        onClick={openPanel}
      >
        🔔{unread > 0 && <span class="notif-count">{unread > 9 ? "9+" : unread}</span>}
      </button>
      <div class="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.key} class={`toast ${t.level}`}>
            <button class="toast-body" type="button" onClick={() => goTo(t.sessionId)}>
              <strong>{t.title}</strong>
              {t.detail && <span>{t.detail}</span>}
            </button>
            <button class="toast-close" type="button" aria-label="Meldung schließen" onClick={() => setToasts((prev) => prev.filter((x) => x.key !== t.key))}>
              ✕
            </button>
          </div>
        ))}
      </div>
      {open && (
        <div class="notif-panel" role="dialog" aria-label="Benachrichtigungen">
          <div class="notif-panel-head">
            <strong>Benachrichtigungen</strong>
            <button class="btn" type="button" onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>
          {items.length === 0 ? (
            <div class="empty">noch keine Meldungen</div>
          ) : (
            items.map((n) => (
              <button key={n.id} class={`notif-item ${n.level}`} type="button" onClick={() => goTo(n.sessionId)}>
                <span class="notif-item-title">{n.title}</span>
                {n.detail && <span class="notif-item-detail">{n.detail}</span>}
                <span class="notif-item-time">{timeAgo(n.createdAt)}</span>
              </button>
            ))
          )}
        </div>
      )}
    </>
  );
}
