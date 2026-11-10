import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { getToken, hostApi, hubApi, remoteHost, type AdapterUsage, type FleetHost, type SessionRecord } from "../../shared/api.ts";
import { parseAppHash, type ToolPageId, TOOL_PAGE_IDS } from "../../app/route.ts";
import { SessionTail } from "../session/SessionTail.tsx";
import { GraphPane } from "../graph/GraphPane.tsx";
import { FileViewer } from "../files/FileViewer.tsx";
import { ToolPane } from "../shell/ToolPane.tsx";
import { VaultPane } from "../vault/VaultPane.tsx";
import { BrowserPanel } from "../browser/BrowserLayer.tsx";
import { publishHubStatus } from "../shell/hub-status.ts";
import { HEARTBEAT_MS, type WindowTarget } from "./protocol.ts";
import { onWindowMessage, openPopout, postWindowMessage, startWindowHub } from "./windows.ts";

function targetFromHash(hash: string): WindowTarget | null {
  const route = parseAppHash(hash);
  if (route.view === "list" && route.page === "vault") return route.vaultFile ? { kind: "vault", path: route.vaultFile } : { kind: "vault" };
  if (route.view === "tail") {
    if (route.browser) return { kind: "browser", sessionId: route.sessionId, ...(route.hostId ? { hostId: route.hostId } : {}) };
    if (route.tab === "graph") return { kind: "graph", sessionId: route.sessionId, ...(route.hostId ? { hostId: route.hostId } : {}) };
    if (route.tab === "datei" && route.file) return { kind: "file", sessionId: route.sessionId, path: route.file, ...(route.hostId ? { hostId: route.hostId } : {}) };
    return { kind: "session", sessionId: route.sessionId, ...(route.hostId ? { hostId: route.hostId } : {}) };
  }
  return (TOOL_PAGE_IDS as readonly string[]).includes(route.page) ? { kind: "tool", page: route.page as ToolPageId } : null;
}

/** Werkzeugseiten lesen ihre Daten aus dem Hub-Status, den im Hauptfenster `App` füllt — hier füllt ihn das Fenster selbst. */
function useToolData(active: boolean) {
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const tick = async () => {
      try {
        const [fleet, adapters] = await Promise.all([
          hubApi.fleet().catch(async () => ({ self: "", hosts: [] as FleetHost[], sessions: await hubApi.sessions() })),
          hubApi.adapters(),
        ]);
        const usage = Object.fromEntries(await Promise.all(adapters.map(async (a) => [a.id, await hubApi.adapterUsage(a.id)] as const))) as Record<string, AdapterUsage>;
        if (alive) publishHubStatus({ connected: true, error: "", lastOkAt: Date.now(), sessions: fleet.sessions, hosts: fleet.hosts, adapters, usage });
      } catch (err) {
        if (alive) publishHubStatus({ connected: false, error: err instanceof Error ? err.message : "load failed" });
      }
    };
    void tick();
    const timer = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [active]);
}

/**
 * EPIC-P34 T34.10: die schlanke Hülle eines eigenen Fensters — eine Session oder eine Werkzeugseite ohne Dock, Liste
 * und Kachel-Tasten. Sie schreibt nie `ancientvoid.workspace` und nie den Hash des Hauptfensters; ihr einziger Draht
 * ins Hauptfenster ist der Kanal (ADR-0053).
 */
export function PopoutShell() {
  const target = useMemo(() => targetFromHash(location.hash), []);
  const id = useRef(crypto.randomUUID()).current;
  const [session, setSession] = useState<SessionRecord | null>(null);
  // Titel-Zeile: Session-Titel, sonst der Projektname — eine Session ohne Titel heißt nicht nur „Session“.
  const sessionLabel = session?.title ?? session?.project.split("/").filter(Boolean).pop() ?? "Session";
  const [error, setError] = useState("");

  useEffect(() => {
    if (!target) return;
    const stop = startWindowHub();
    const hello = () => postWindowMessage({ type: "hello", id, target });
    hello();
    const beat = setInterval(() => postWindowMessage({ type: "heartbeat", id }), HEARTBEAT_MS);
    const off = onWindowMessage((msg) => {
      if (msg.type === "ping") hello();
      if (msg.type === "focus" && msg.id === id) {
        window.focus();
        // Prüfbar ohne Bildschirm: Browser dürfen `focus()` ohne Nutzeraktion verweigern.
        document.documentElement.dataset.focusRequests = String(Number(document.documentElement.dataset.focusRequests ?? "0") + 1);
      }
    });
    const bye = () => postWindowMessage({ type: "bye", id });
    window.addEventListener("pagehide", bye);
    return () => {
      clearInterval(beat);
      off();
      window.removeEventListener("pagehide", bye);
      bye();
      stop();
    };
  }, []);

  useEffect(() => {
    if (target?.kind !== "session" && target?.kind !== "graph" && target?.kind !== "file" && target?.kind !== "browser") return;
    hostApi(target.hostId)
      .session(target.sessionId)
      .then((s) => {
        setSession(s);
        const label = s.title ?? s.project.split("/").pop() ?? "Session";
        document.title = `⧉ ${target.kind === "graph" ? `Graph · ${label}` : target.kind === "file" ? `${target.path.split("/").pop()} · ${label}` : label}`;
      })
      .catch(() => setError("Diese Session gibt es nicht mehr oder sie ist nicht erreichbar."));
  }, []);
  useToolData(target?.kind === "tool");

  // Offline: das Fenster sagt es, statt still zu veralten (der Tail verbindet sich selbst neu).
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const giveBack = () => {
    if (target) postWindowMessage({ type: "return", id, target });
    window.close();
  };

  if (!target) return <div class="popout-shell"><div class="empty">Dieses Fenster hat kein Ziel.</div></div>;
  if (!getToken()) return <div class="popout-shell"><div class="empty">Nicht angemeldet — bitte im Hauptfenster anmelden und dieses Fenster neu laden.</div></div>;
  return (
    <div class="popout-shell">
      <header class="popout-bar">
        <span class="popout-title">
          ⧉ {target.kind === "tool" ? "Werkzeug" : target.kind === "vault" ? `Notizen${target.path ? ` · ${target.path.split("/").pop()}` : ""}` : target.kind === "browser" ? `Browser · ${sessionLabel}` : target.kind === "graph" ? `Repo-Graph · ${sessionLabel}` : target.kind === "file" ? `Datei · ${target.path.split("/").pop()}` : sessionLabel}
        </span>
        <button type="button" class="btn" onClick={giveBack}>
          In die App zurück
        </button>
      </header>
      {!online && <div class="popout-offline" role="status">Offline — dieses Fenster zeigt den letzten Stand und verbindet sich neu, sobald das Netz wieder da ist.</div>}
      {target.kind === "session" ? (
        error ? (
          <div class="empty">{error}</div>
        ) : session ? (
          <section class="tile popout-tile" data-tile="1" aria-label="Session">
            <SessionTail key={session.id} session={session} onNavigate={() => undefined} tile={{ active: true, compact: false }} />
          </section>
        ) : (
          <div class="empty dim">lädt…</div>
        )
      ) : target.kind === "graph" ? (
        error ? (
          <div class="empty">{error}</div>
        ) : (
          // EPIC-P48: Der Graph des eigenen Fensters öffnet Dateien als weitere eigene Fenster.
          <div class="popout-graph">
            <GraphPane
              target={`session=${encodeURIComponent(target.sessionId)}`}
              hostId={target.hostId ?? null}
              onOpenFile={(path) => void openPopout({ kind: "file", sessionId: target.sessionId, path, ...(target.hostId ? { hostId: target.hostId } : {}) })}
            />
          </div>
        )
      ) : target.kind === "file" ? (
        error ? (
          <div class="empty">{error}</div>
        ) : (
          <div class="popout-file">
            <FileViewer target={`session=${encodeURIComponent(target.sessionId)}`} path={target.path} hostId={target.hostId ?? null} />
          </div>
        )
      ) : target.kind === "vault" ? (
        // EPIC-P49: Der Vault lädt seine Daten selbst — dasselbe Ziel wie der Tab, als Fenster.
        <div class="popout-tool">
          <VaultPane {...(target.path ? { initialFile: target.path } : {})} />
        </div>
      ) : target.kind === "browser" ? (
        // EPIC-P39 T39.3-Rest: Browser-Panel als eigenes Fenster; lädt Status/Bild selbst per HTTP.
        error ? (
          <div class="empty">{error}</div>
        ) : (
          <div class="popout-browser">
            <BrowserPanel
              sessionId={target.sessionId}
              label={sessionLabel === "Session" ? null : sessionLabel}
              hostId={target.hostId ?? null}
              onClose={giveBack}
            />
          </div>
        )
      ) : (
        <div class="popout-tool">
          <ToolPane
            page={target.page}
            onClose={giveBack}
            onOpen={(s) => void openPopout({ kind: "session", sessionId: s.id, ...(remoteHost(s.hostId) ? { hostId: remoteHost(s.hostId)! } : {}) })}
            onSwitchToken={() => location.reload()}
            closeLabel="In die App zurück"
            escCloses={false}
          />
        </div>
      )}
    </div>
  );
}
