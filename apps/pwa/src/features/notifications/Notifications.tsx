import { useEffect, useRef, useState } from "preact/hooks";
import { hubApi, hostApi, type HubNotification } from "../../shared/api.ts";
import { sessionHash } from "../../app/route.ts";
import { registerShortcut } from "../../shared/shortcuts/registry.ts";
import { useOverlayFocus } from "../../shared/overlay-focus.ts";

const READ_KEY = "ancientvoid.notifications.readUpTo";
/** EPIC-P6: read marks of other hosts, { hostId: lastReadId }. */
const PEER_READ_KEY = "ancientvoid.notifications.readByHost";
const POLL_MS = 4000;
/** BUG-0049: a short blip (a few seconds) is no outage — announce "nicht erreichbar" (and later "wieder da") only after this many failed polls in a row. */
const HUB_DOWN_AFTER = 3;
const PEERS_REFRESH_MS = 60_000;
/** Errors stay longer — they usually need an action. Warnings too: a warning
 * that vanishes before it is read (observed 2026-10-24, 8 s) is noise, not a
 * notification. Success/info stay short. */
const TOAST_MS: Record<HubNotification["level"], number> = { error: 30_000, warning: 25_000, success: 6000, info: 8000 };

interface Toast {
  key: string;
  level: HubNotification["level"];
  title: string;
  detail: string | null;
  sessionId: string | null;
  hostId: string | null;
}

/** A notification with the host it came from (null = this hub). */
type FleetNotification = HubNotification & { hostId: string | null; key: string };

function readMarks(): Record<string, number> {
  let peers: Record<string, number> = {};
  try {
    peers = JSON.parse(localStorage.getItem(PEER_READ_KEY) ?? "{}") as Record<string, number>;
  } catch {
    peers = {};
  }
  return { ...peers, "": Number(localStorage.getItem(READ_KEY) ?? 0) || 0 };
}

function saveReadMarks(marks: Record<string, number>): void {
  const { "": local = 0, ...peers } = marks;
  localStorage.setItem(READ_KEY, String(local));
  localStorage.setItem(PEER_READ_KEY, JSON.stringify(peers));
}

export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "gerade eben";
  if (seconds < 3600) return `vor ${Math.floor(seconds / 60)} min`;
  if (seconds < 86_400) return `vor ${Math.floor(seconds / 3600)} h`;
  return new Date(iso).toLocaleDateString("de-DE");
}

/** T8.1: at most two toasts over the content — errors first; the rest
 * waits in the bell instead of covering the overview. */
const TOASTS_SHOWN = 2;
const TOAST_RANK: Record<string, number> = { error: 0, warning: 1, info: 2, success: 3 };

function visibleToasts<T extends { level: string }>(toasts: T[]): T[] {
  return [...toasts].sort((a, b) => (TOAST_RANK[a.level] ?? 9) - (TOAST_RANK[b.level] ?? 9)).slice(0, TOASTS_SHOWN);
}

/**
 * ADR-0015: toasts top right for new errors and status changes, plus a bell
 * with the recent list. Polls the hub; the first load only fills the list,
 * so opening the app never replays old toasts.
 */
const APPROVAL_KINDS = new Set(["tool.permission_requested", "session.steer_pending_approval"]);

/** `corner`: the list column is folded away, so bell and gear sit in the window corner. */
export function NotificationCenter({ corner = false }: { corner?: boolean }) {
  const [items, setItems] = useState<FleetNotification[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState(readMarks);
  // EPIC-P51 T51.6: Esc schließt das Panel, Fokus rein/Tab-Falle/zurück auf die Glocke.
  const closeBtn = useRef<HTMLButtonElement>(null);
  const { ref: panelRef } = useOverlayFocus<HTMLDivElement>(open, { preferred: () => closeBtn.current });
  useEffect(() => {
    if (!open) return;
    return registerShortcut("notifications.close", (e) => {
      e.preventDefault();
      setOpen(false);
    });
  }, [open]);
  // Per host (key "" = this hub): newest id seen; null = not loaded yet.
  const lastIds = useRef<Record<string, number | null>>({});
  const peers = useRef<string[]>([]);
  const failures = useRef(0);

  const toast = (t: Toast) => {
    setToasts((prev) => [t, ...prev].slice(0, 4));
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.key !== t.key)), TOAST_MS[t.level]);
  };

  const take = (hostId: string | null, page: { items: HubNotification[]; lastId: number }) => {
    const key = hostId ?? "";
    const known = lastIds.current[key] ?? null;
    const stamped = page.items.map((n) => ({
      ...n,
      hostId,
      key: `${key}#${n.id}`,
      title: hostId ? `${hostId} · ${n.title}` : n.title,
    }));
    if (known !== null) {
      // T8.6: "Zug fertig" goes to the bell only — with many sessions its
      // toasts covered the controls at the top for seconds (P8 Messlauf).
      for (const n of [...stamped].reverse()) {
        if (n.kind === "session.turn_end") continue;
        const show = () => toast({ key: n.key, level: n.level, title: n.title, detail: n.detail, sessionId: n.sessionId, hostId });
        // Premortem P8-2: an approval decided meanwhile (e.g. a peer's
        // notification that arrived late) is no toast any more.
        if (APPROVAL_KINDS.has(n.kind))
          void hostApi(hostId)
            .approvals("pending")
            .then((pending) => pending.some((a) => a.sessionId === n.sessionId) && show())
            .catch(show);
        else show();
      }
    }
    if (stamped.length > 0) {
      setItems((prev) => [...stamped, ...prev].sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1)).slice(0, 100));
    }
    lastIds.current[key] = Math.max(known ?? 0, page.lastId);
  };

  useEffect(() => {
    let alive = true;
    const loadPeers = () =>
      hubApi
        .fleetPeers()
        .then((list) => (peers.current = list.map((p) => p.hostId)))
        .catch(() => undefined);
    const poll = async () => {
      try {
        const page = await hubApi.notifications(lastIds.current[""] ?? 0);
        if (!alive) return;
        if (failures.current >= HUB_DOWN_AFTER) toast({ key: `hub-${Date.now()}`, level: "success", title: "Verbindung zum Hub wieder da", detail: null, sessionId: null, hostId: null });
        failures.current = 0;
        take(null, page);
      } catch {
        if (!alive) return;
        failures.current += 1;
        if (failures.current === HUB_DOWN_AFTER) {
          toast({ key: `hub-${Date.now()}`, level: "warning", title: "Hub nicht erreichbar", detail: "Neue Meldungen kommen, sobald er wieder antwortet.", sessionId: null, hostId: null });
        }
      }
      // EPIC-P6 T6.6: other hosts' notifications through this hub. A host
      // that is away stays quiet here — the overview shows its state.
      await Promise.all(
        peers.current.map((hostId) =>
          hostApi(hostId)
            .notifications(lastIds.current[hostId] ?? 0)
            .then((page) => alive && take(hostId, page))
            .catch(() => undefined),
        ),
      );
    };
    void loadPeers().then(() => poll());
    const timer = setInterval(() => void poll(), POLL_MS);
    const peerTimer = setInterval(() => void loadPeers(), PEERS_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
      clearInterval(peerTimer);
    };
  }, []);

  const unread = items.filter((n) => n.id > (read[n.hostId ?? ""] ?? 0)).length;

  const openPanel = () => {
    setOpen((was) => !was);
    const marks = { ...read };
    for (const n of items) marks[n.hostId ?? ""] = Math.max(marks[n.hostId ?? ""] ?? 0, n.id);
    saveReadMarks(marks);
    setRead(marks);
  };

  const goTo = (sessionId: string | null, hostId: string | null) => {
    setOpen(false);
    if (sessionId) location.hash = sessionHash(sessionId, hostId);
  };

  return (
      <>
      <button
        class={`notif-bell${corner ? " corner" : ""}`}
        type="button"
        aria-label={unread > 0 ? `Benachrichtigungen (${unread} neu)` : "Benachrichtigungen"}
        title="Benachrichtigungen"
        onClick={openPanel}
      >
        🔔{unread > 0 && <span class="notif-count">{unread > 9 ? "9+" : unread}</span>}
      </button>
      <div class="toast-stack" role="status" aria-live="polite">
        {visibleToasts(toasts).map((t) => (
          <div key={t.key} class={`toast ${t.level}`}>
            <button class="toast-body" type="button" onClick={() => goTo(t.sessionId, t.hostId)}>
              <strong>{t.title}</strong>
              {t.detail && <span>{t.detail}</span>}
            </button>
            <button class="toast-close" type="button" aria-label="Meldung schließen" onClick={() => setToasts((prev) => prev.filter((x) => x.key !== t.key))}>
              ✕
            </button>
          </div>
        ))}
        {toasts.length > TOASTS_SHOWN && (
          <button class="toast-more" type="button" onClick={openPanel}>
            +{toasts.length - TOASTS_SHOWN} weitere Meldungen
          </button>
        )}
      </div>
      {open && (
        <div class={`notif-panel${corner ? " corner" : ""}`} role="dialog" aria-label="Benachrichtigungen" ref={panelRef} tabIndex={-1}>
          <div class="notif-panel-head">
            <strong>Benachrichtigungen</strong>
            <button class="btn" type="button" ref={closeBtn} onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>
          {items.length === 0 ? (
            <div class="empty">noch keine Meldungen</div>
          ) : (
            items.map((n) => (
              <button key={n.key} class={`notif-item ${n.level}`} type="button" onClick={() => goTo(n.sessionId, n.hostId)}>
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
