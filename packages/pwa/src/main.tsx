import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { App } from "./App.tsx";
import { SessionTail } from "./SessionTail.tsx";
import { getToken, setToken, hubApi, type SessionRecord } from "./api.ts";
import { applyTheme, getTheme } from "./theme.ts";
import type { Page } from "./Dock.tsx";
import "./styles.css";

// T1.6-2: applied before the first render so a stored "light" preference
// never flashes dark first — index.html's data-theme="dark" was previously
// the only value that ever existed.
applyTheme(getTheme());

function TokenGate({ onReady }: { onReady: () => void }) {
  const [token, setVal] = useState(getToken());
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

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
        <input
          type="password"
          value={token}
          onInput={(e) => setVal((e.target as HTMLInputElement).value)}
          placeholder="uacc-…"
        />
      </label>
      {error && <div style="color: var(--err)">{error}</div>}
      <button class="btn primary" onClick={submit} disabled={checking}>
        {checking ? "Prüfe…" : "Verbinden"}
      </button>
    </div>
  );
}

function Main() {
  const [ready, setReady] = useState(false);
  const [route, setRoute] = useState<
    { view: "list"; initialPage?: Page } | { view: "tail"; session: SessionRecord }
  >({ view: "list" });

  useEffect(() => {
    // BUG-0006 (part 2): /api/health is deliberately open (tailnet
    // monitoring) — using it here to decide "ready" meant this always
    // succeeded regardless of whether a valid token existed, so
    // TokenGate could never actually appear for a device without one.
    // adapters() is a real, token-protected endpoint.
    hubApi
      .adapters()
      .then(() => setReady(true))
      .catch(() => setReady(false));
  }, []);

  useEffect(() => {
    const onStale = () => setStaleAt(new Date());
    document.addEventListener("uacc:stale-data", onStale);
    return () => document.removeEventListener("uacc:stale-data", onStale);
  }, []);

  const [staleAt, setStaleAt] = useState<Date | null>(null);

  if (!ready) return <TokenGate onReady={() => setReady(true)} />;

  return (
    <>
      {staleAt && (
        <div class="topbar">
          <span class="badge-stale">Daten vom {staleAt.toLocaleString("de-DE")} (offline)</span>
        </div>
      )}
      {route.view === "list" ? (
        <App
          onOpen={(session) => setRoute({ view: "tail", session })}
          ready={() => setReady(false)}
          initialPage={route.initialPage}
        />
      ) : (
        // T1.6-3: one callback back into the list, optionally landing on a
        // specific dock page — "Übersicht ist aus jedem Kontext heraus mit
        // einem Tap erreichbar" applies to Neue Session/Einstellungen too.
        <SessionTail session={route.session} onNavigate={(page) => setRoute({ view: "list", initialPage: page })} />
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
