import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { App } from "./App.tsx";
import { SessionTail } from "../features/session/SessionTail.tsx";
import { getToken, isAuthError, setToken, hubApi, hostApi, remoteHost, setSelfHostId, type SessionRecord } from "../shared/api.ts";
import { resyncPush } from "../shared/push.ts";
import { CommandBar } from "../features/commands/CommandBar.tsx";
import { pageHash, parseAppHash, sessionHash, type CodeTarget } from "./route.ts";
import { applyTheme, getTheme } from "./theme.ts";
import { NotificationCenter } from "../features/notifications/Notifications.tsx";
import type { Page } from "./Dock.tsx";
import "./styles/index.css";

// T1.6-2: applied before the first render so a stored "light" preference
// never flashes dark first — index.html's data-theme="dark" was previously
// the only value that ever existed.
applyTheme(getTheme());

function TokenGate({ onReady }: { onReady: () => void }) {
  const [token, setVal] = useState(getToken());
  const [error, setError] = useState("");
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
      <h2 style="margin: 0">UACC Hub</h2>
      <p class="dim" style="margin: 0">
        Device-Token eingeben (wird beim Start des Hubs via <code>hubctl token issue</code> erzeugt).
      </p>
      <label>
        Device-Token
        <div style="display: flex; gap: 8px">
          <input
            type={reveal ? "text" : "password"}
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
  // EPIC-P6: know this hub's host id before any session opens, so its own
  // sessions keep short links and direct calls.
  const becomeReady = async () => {
    await hubApi
      .fleetHello()
      .then((h) => setSelfHostId(h.hostId))
      .catch(() => setSelfHostId(null));
    setReady(true);
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
          if ((e.data as { type?: string })?.type === "uacc:push-resubscribe") void resyncPush();
        });
      })
      .catch((err) => {
        if (getToken() && !isAuthError(err)) void becomeReady();
        else setReady(false);
      });
  }, []);

  useEffect(() => {
    const onStale = (e: Event) => {
      const at = new Date(String((e as CustomEvent<string>).detail ?? ""));
      setStaleAt(Number.isNaN(at.getTime()) ? new Date() : at);
    };
    const onOnline = () => setStaleAt(null);
    window.addEventListener("online", onOnline);
    document.addEventListener("uacc:stale-data", onStale);
    return () => {
      document.removeEventListener("uacc:stale-data", onStale);
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

  if (!ready) return <TokenGate onReady={() => void becomeReady()} />;

  return (
    <>
      {!wide && <NotificationCenter />}
      {staleAt && (
        <div class="topbar">
          <span class="badge-stale">Daten vom {staleAt.toLocaleString("de-DE")} (offline)</span>
        </div>
      )}
      <CommandBar />
      {wide ? (
        // T8.5 (AC-P8-6): from 1280 px list and session side by side.
        <div class="split">
          <aside class="split-list">
            <NotificationCenter />
            <App
              onOpen={(session) => {
                location.hash = sessionHash(session.id, remoteHost(session.hostId));
                setRoute({ view: "tail", session });
              }}
              ready={() => setReady(false)}
              page={route.view === "list" ? route.page : "dashboard"}
            />
          </aside>
          <section class="split-detail">
            {route.view === "tail" ? (
              <SessionTail
                key={route.session.id}
                session={route.session}
                {...(route.code ? { initialCode: route.code } : {})}
                onNavigate={(page) => {
                  location.hash = pageHash(page);
                }}
              />
            ) : (
              <div class="empty split-placeholder">Session links wählen</div>
            )}
          </section>
        </div>
      ) : route.view === "list" ? (
        <App
          onOpen={(session) => {
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

render(<Main />, document.getElementById("app")!);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}
