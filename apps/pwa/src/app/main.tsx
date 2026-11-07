import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { App } from "./App.tsx";
import { SessionTail } from "../features/session/SessionTail.tsx";
import { getToken, isAuthError, setToken, hubApi, hostApi, remoteHost, setSelfHostId, type SessionRecord } from "../shared/api.ts";
import { resyncPush } from "../shared/push.ts";
import { CommandBar } from "../features/commands/CommandBar.tsx";
import { isToolPage, pageHash, parseAppHash, sessionHash, type CodeTarget } from "./route.ts";
import { applyTheme, getTheme } from "./theme.ts";
import { initAppearance } from "./appearance.ts";
import { applyPinchZoom, pinchZoomAllowed } from "./zoom.ts";
import { applyCtxMotion, applyScale, ctxMotionOn, getScale, installScaleShortcuts } from "./ui-scale.ts";
import { captureShareTarget, storeShareInbox } from "./share-inbox.ts";
import { NotificationCenter } from "../features/notifications/Notifications.tsx";
import { TileWorkspace } from "../features/workspace/TileWorkspace.tsx";
import { StatusBar } from "../features/shell/StatusBar.tsx";
import { getHubStatus } from "../features/shell/hub-status.ts";
import { ToolPane } from "../features/shell/ToolPane.tsx";
import { rememberSession } from "../features/shell/last-session.ts";
import { RestoreBar } from "../features/windows/RestoreBar.tsx";
import { PopoutShell } from "../features/windows/PopoutShell.tsx";
import type { DropPoint } from "../features/windows/drag.ts";
import { focusWindowFor, isPopoutWindow, onWindowMessage, openPopout, startWindowHub } from "../features/windows/windows.ts";
import { detachTile, forgetDetached, openInNewTile, openSession, parseWorkspace, reattach, serializeWorkspace, visibleTiles, type TileRef, type Workspace } from "../features/workspace/tiles.ts";
import type { Page } from "./Dock.tsx";
import "./styles/index.css";

// T1.6-2: applied before the first render so a stored "light" preference
// never flashes dark first — index.html's data-theme="dark" was previously
// the only value that ever existed.
applyTheme(getTheme());
// EPIC-P34 T34.4: Akzentfarbe, Schrift und Größe dieses Geräts, ebenfalls vor dem ersten Paint.
initAppearance();
applyPinchZoom(pinchZoomAllowed());
// EPIC-P20: UI scale (Ctrl+wheel, Ctrl +/−/0) and the context-bar shimmer, before the first paint.
applyScale(getScale());
applyCtxMotion(ctxMotionOn());
installScaleShortcuts();

function TokenGate({ onReady, rejected }: { onReady: () => void; rejected: string }) {
  const [token, setVal] = useState(getToken());
  const [error, setError] = useState("");
  // BUG-0054: the automatic check fails after the first paint. Without this,
  // a stored token that the hub rejects leaves a filled field and "Verbinden"
  // and no reason.
  useEffect(() => {
    if (rejected) setError(rejected);
  }, [rejected]);
  const [checking, setChecking] = useState(false);
  // Real find: a hidden, case-sensitive, hyphen-containing token typed on a
  // phone keyboard is exactly the kind of input mobile autocorrect/
  // autocapitalize silently mangles, and type="password" means the user
  // can never see what actually landed in the field to catch it.
  const [reveal, setReveal] = useState(false);

  const submit = async () => {
    setChecking(true);
    setError("");
    try {
      setToken(token.trim());
      // BUG-0006 (part 2): health() needs no token, so this used to
      // "verify" an empty or wrong token as valid — the actual API calls
      // would then 401 on the very next screen. adapters() is protected.
      await hubApi.adapters();
      onReady();
    } catch (err) {
      setError(err instanceof Error ? err.message : "connection failed");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div class="card form-grid" style="margin-top: 20vh">
      <img class="login-artwork" src="/assets/artwork-tempel.webp" alt="" width="1280" height="720" />
      <h2 style="margin: 0">Anmeldung bei AncientVoid</h2>
      <p class="dim" style="margin: 0">
        Device-Token eingeben (wird beim Start des Hubs via <code>hubctl token issue</code> erzeugt).
      </p>
      <label>
        Device-Token
        <div style="display: flex; gap: 8px">
          <input
            // Preact 11 typisiert <input> je type-Variante; ein Literal-Union passt zu keiner.
            {...(reveal ? { type: "text" as const } : { type: "password" as const })}
            value={token}
            onInput={(e) => setVal((e.target as HTMLInputElement).value)}
            placeholder="z. B. 00bYRN3zmTJJIsfneN4iZmOQKsJl5q-s"
            autocapitalize="off"
            autocorrect="off"
            autocomplete="off"
            spellcheck={false}
            style="flex: 1"
          />
          <button
            type="button"
            class="btn"
            onClick={() => setReveal((v) => !v)}
            title={reveal ? "Token verbergen" : "Token anzeigen"}
          >
            {reveal ? "🙈" : "👁"}
          </button>
        </div>
      </label>
      {error && <div style="color: var(--err)">{error}</div>}
      <button class={checking ? "btn primary busy" : "btn primary"} aria-busy={checking} onClick={submit} disabled={checking}>
        {checking ? "lädt…" : "Verbinden"}
      </button>
    </div>
  );
}

const WIDE = "(min-width: 1280px)";
const WORKSPACE_KEY = "ancientvoid.workspace";
const LIST_COLLAPSED_KEY = "ancientvoid.listCollapsed";

function tileRefOf(session: SessionRecord): TileRef {
  const host = remoteHost(session.hostId);
  return host ? { sessionId: session.id, hostId: host } : { sessionId: session.id };
}

function useWide(): boolean {
  const [wide, setWide] = useState(() => matchMedia(WIDE).matches);
  useEffect(() => {
    const mq = matchMedia(WIDE);
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

function Main() {
  const [ready, setReady] = useState(false);
  const [gateError, setGateError] = useState("");
  // EPIC-P6: know this hub's host id before any session opens, so its own
  // sessions keep short links and direct calls.
  const becomeReady = () => {
    // Token validation is the login gate; fleet discovery must not keep the
    // user on the token form when a peer or local handshake is slow.
    setReady(true);
    void hubApi
      .fleetHello()
      .then((h) => setSelfHostId(h.hostId))
      .catch(() => setSelfHostId(null));
  };
  const [route, setRoute] = useState<
    { view: "list"; page: Page } | { view: "tail"; session: SessionRecord; code?: CodeTarget }
  >({ view: "list", page: "dashboard" });

  useEffect(() => {
    // BUG-0006 (part 2): /api/health is deliberately open (tailnet
    // monitoring) — using it here to decide "ready" meant this always
    // succeeded regardless of whether a valid token existed, so
    // TokenGate could never actually appear for a device without one.
    // adapters() is a real, token-protected endpoint.
    // BUG-0015 / T8.2: offline (no network, 503 from the service worker) is
    // not a wrong token — with a token, start on the cached data.
    hubApi
      .adapters()
      .then(() => {
        void becomeReady();
        // T8.3: a rotated push subscription is registered again.
        void resyncPush();
        navigator.serviceWorker?.addEventListener("message", (e) => {
          if ((e.data as { type?: string })?.type === "ancientvoid:push-resubscribe") void resyncPush();
        });
      })
      .catch((err) => {
        if (getToken() && !isAuthError(err)) void becomeReady();
        else {
          setReady(false);
          // BUG-0054: a rejected stored token used to leave the gate silent.
          if (getToken()) setGateError(err instanceof Error ? err.message : "Anmeldung abgelehnt");
        }
      });
  }, []);

  useEffect(() => {
    const onStale = (e: Event) => {
      const at = new Date(String((e as CustomEvent<string>).detail ?? ""));
      setStaleAt(Number.isNaN(at.getTime()) ? new Date() : at);
    };
    const onOnline = () => setStaleAt(null);
    window.addEventListener("online", onOnline);
    document.addEventListener("ancientvoid:stale-data", onStale);
    return () => {
      document.removeEventListener("ancientvoid:stale-data", onStale);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const openFromHash = () => {
      const parsed = parseAppHash(location.hash);
      if (parsed.view !== "tail") {
        setRoute({ view: "list", page: parsed.page });
        return;
      }
      hostApi(parsed.hostId)
        .session(parsed.sessionId)
        .then((session) => setRoute({ view: "tail", session, ...(parsed.code ? { code: parsed.code } : {}) }))
        .catch(() => setRoute({ view: "list", page: "dashboard" }));
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, [ready]);

  const [staleAt, setStaleAt] = useState<Date | null>(null);
  const wide = useWide();

  // EPIC-P18 T18.5: layout and tiles are this device's choice; the hash
  // follows the focused tile (replaceState: focus moves are no history).
  const [listCollapsed, setListCollapsed] = useState(() => localStorage.getItem(LIST_COLLAPSED_KEY) === "1");
  const [ws, setWs] = useState(() => parseWorkspace(localStorage.getItem(WORKSPACE_KEY)));
  const changeWorkspace = (next: Workspace) => {
    setWs(next);
    localStorage.setItem(WORKSPACE_KEY, serializeWorkspace(next));
    const focused = visibleTiles(next)[next.focus];
    rememberSession(focused ?? null);
    const hash = focused ? sessionHash(focused.sessionId, focused.hostId) : pageHash(route.view === "list" ? route.page : "dashboard");
    if (location.hash !== hash) history.replaceState(null, "", hash);
  };
  // EPIC-P34 T34.10: eigene Fenster. Der Kanal-Handler läuft über Referenzen, damit er immer den neuesten Stand sieht.
  const latest = useRef({ ws, changeWorkspace });
  latest.current = { ws, changeWorkspace };
  const [popoutNotice, setPopoutNotice] = useState("");
  const [retryPopout, setRetryPopout] = useState<(() => void) | null>(null);
  useEffect(() => {
    const stop = startWindowHub();
    const off = onWindowMessage((msg) => {
      if (msg.type !== "return" || msg.target.kind !== "session") return;
      const ref: TileRef = msg.target.hostId ? { sessionId: msg.target.sessionId, hostId: msg.target.hostId } : { sessionId: msg.target.sessionId };
      latest.current.changeWorkspace(reattach(latest.current.ws, ref));
    });
    return () => {
      off();
      stop();
    };
  }, []);
  const blockedNotice = "Das Fenster wurde nicht geöffnet. Der Browser blockiert Pop-ups für diese Seite — bitte erlauben und noch einmal versuchen.";
  const popoutTile = async (index: number, drop?: DropPoint) => {
    const ref = latest.current.ws.slots[index];
    if (!ref) return;
    const result = await openPopout({ kind: "session", sessionId: ref.sessionId, ...(ref.hostId ? { hostId: ref.hostId } : {}) }, drop);
    if (result === "blocked") {
      setPopoutNotice(blockedNotice);
      // Rückfall der Ziehgeste: die Nutzeraktion kann abgelaufen sein — ein Klick auf den Knopf ist eine frische.
      setRetryPopout(() => () => void popoutTile(index));
    }
    else {
      setPopoutNotice("");
      latest.current.changeWorkspace(detachTile(latest.current.ws, index));
    }
  };
  // EPIC-P34 T34.2: a tool page (settings, media …) fills the detail column on a wide screen.
  const toolPage = route.view === "list" && isToolPage(route.page) ? route.page : null;
  const openFromList = (session: SessionRecord, opts?: { newTile?: boolean }) => {
    const ref = tileRefOf(session);
    // EPIC-P34 T34.10: läuft die Session in einem eigenen Fenster, kommt dieses nach vorn — kein zweiter Composer.
    if (focusWindowFor({ kind: "session", sessionId: ref.sessionId, ...(ref.hostId ? { hostId: ref.hostId } : {}) })) return;
    setRoute({ view: "tail", session });
    // Kein Fenster mehr da (geschlossen, abgestürzt): die Session gehört wieder in eine Kachel.
    const base = forgetDetached(ws, ref);
    changeWorkspace(opts?.newTile ? openInNewTile(base, ref) : openSession(base, ref));
  };
  // A deep link or Back to a session lands in the workspace too.
  useEffect(() => {
    if (!wide || route.view !== "tail") return;
    const next = openSession(ws, tileRefOf(route.session));
    if (next !== ws && (next.focus !== ws.focus || next.slots !== ws.slots)) changeWorkspace(next);
  }, [wide, route]);

  // EPIC-P23 T23.1: a deep link or a reload on a session counts as "worked in last", too.
  useEffect(() => {
    if (route.view === "tail") rememberSession(tileRefOf(route.session));
  }, [route]);

  if (!ready) return <TokenGate onReady={() => void becomeReady()} rejected={gateError} />;

  return (
    <>
      {!wide && <NotificationCenter />}
      {wide && listCollapsed && <NotificationCenter corner />}
      {staleAt && (
        <div class="topbar">
          <span class="badge-stale">Daten vom {staleAt.toLocaleString("de-DE")} (offline)</span>
        </div>
      )}
      <CommandBar />
      {wide && (
        <RestoreBar
          ws={ws}
          sessions={getHubStatus().sessions}
          onOpen={(ref) => {
            void openPopout({ kind: "session", sessionId: ref.sessionId, ...(ref.hostId ? { hostId: ref.hostId } : {}) }).then((result) => {
              if (result === "blocked") setPopoutNotice(blockedNotice);
            });
          }}
          onDiscard={(refs) => changeWorkspace(refs.reduce((acc, ref) => forgetDetached(acc, ref), ws))}
        />
      )}
      {popoutNotice && (
        <div class="popout-notice" role="alert">
          {popoutNotice}{" "}
          {retryPopout && (
            <button
              type="button"
              class="btn"
              onClick={() => {
                setPopoutNotice("");
                retryPopout();
              }}
            >
              Fenster öffnen
            </button>
          )}{" "}
          <button type="button" class="link-btn" onClick={() => setPopoutNotice("")}>
            Schließen
          </button>
        </div>
      )}
      {wide ? (
        // T8.5 (AC-P8-6): from 1280 px list and session side by side.
        <div class={`split${listCollapsed ? " list-collapsed" : ""}`}>
          <aside class="split-list">
            <NotificationCenter />
            <App wide onOpen={openFromList} ready={() => setReady(false)} page={route.view === "list" ? route.page : "dashboard"} />
          </aside>
          <section class="split-detail">
            {/* EPIC-P18: up to four sessions as tiles. */}
            <div class="tile-host" {...({ inert: toolPage !== null } as object)}>
            <TileWorkspace
              listCollapsed={listCollapsed}
              onToggleList={() =>
                setListCollapsed((v) => {
                  localStorage.setItem(LIST_COLLAPSED_KEY, v ? "0" : "1");
                  return !v;
                })
              }
              ws={ws}
              onChange={changeWorkspace}
              onPopout={(index, drop) => void popoutTile(index, drop)}
              {...(route.view === "tail" && route.code ? { initialCode: { sessionId: route.session.id, code: route.code } } : {})}
              onNavigate={(page) => {
                location.hash = pageHash(page);
              }}
            />
            </div>
            {toolPage && (
              <ToolPane
                page={toolPage}
                onClose={() => {
                  location.hash = pageHash("dashboard");
                }}
                onOpen={(session) => openFromList(session)}
                onSwitchToken={() => setReady(false)}
                onPopout={() => {
                  void openPopout({ kind: "tool", page: toolPage }).then((result) => {
                    if (result === "blocked") setPopoutNotice(blockedNotice);
                    else {
                      setPopoutNotice("");
                      location.hash = pageHash("dashboard");
                    }
                  });
                }}
              />
            )}
          </section>
          <StatusBar focused={visibleTiles(ws)[ws.focus] ?? null} onOpenApprovals={() => (location.hash = pageHash("approvals"))} />
        </div>
      ) : route.view === "list" ? (
        <App
          onOpen={(session) => {
            rememberSession(tileRefOf(session));
            location.hash = sessionHash(session.id, remoteHost(session.hostId));
            setRoute({ view: "tail", session });
          }}
          ready={() => setReady(false)}
          page={route.page}
        />
      ) : (
        // T1.6-3: one callback back into the list, optionally landing on a
        // specific dock page — "Übersicht ist aus jedem Kontext heraus mit
        // einem Tap erreichbar" applies to Neue Session/Einstellungen too.
        // BUG-0024: keyed by id — a link from one session to another must
        // not keep the first session's events, filter or reply draft.
        <SessionTail
          key={route.session.id}
          session={route.session}
          {...(route.code ? { initialCode: route.code } : {})}
          onNavigate={(page) => {
            location.hash = pageHash(page);
          }}
        />
      )}
    </>
  );
}

// AI-P9-2: aus dem Teilen-Menü einer anderen App — Query aufräumen und
// direkt auf "Neu" landen, der Auftrag wird vorbefüllt. Läuft vor dem
// ersten Render, damit Token-Gate und Offline-Start denselben Zustand sehen.
const shared = captureShareTarget(location.search);
if (shared) {
  storeShareInbox(shared.text);
  history.replaceState(null, "", "/#/neu");
}

// EPIC-P34 T34.10: `/?window=1` ist ein eigenes Fenster — nur die schlanke Hülle, nie das Hauptfenster.
render(isPopoutWindow() ? <PopoutShell /> : <Main />, document.getElementById("app")!);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}
