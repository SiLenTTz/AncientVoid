import { useEffect, useRef, useState } from "preact/hooks";
import type { BrowserPick, BrowserStatus, BrowserTestRun, BrowserViewportName } from "@ancientvoid/contracts";
import { hubApi, remoteHost } from "../../shared/api.ts";
import { openPopout } from "../windows/windows.ts";
import { getHubStatus } from "../shell/hub-status.ts";
import { onLayerOpen } from "../../shared/layers.ts";
import { EXAMPLE_TEST, TEST_STATE_LABEL, parseTestCase, toViewportPoint } from "./browser-model.ts";

type Tab = "view" | "tests" | "log";

/**
 * EPIC-P39 T39.3–T39.5 (ADR-0059): Browser-Panel. Chromium läuft auf dem Host der Session, die PWA zeigt nur ein
 * begrenztes Standbild und schickt Aktionen. Der Host-/Sessionbezug steht immer im Kopf; offline bleibt das letzte
 * Bild mit Zeitstempel sichtbar, die Eingabe ist gesperrt.
 */
export function BrowserLayer({ focusedSessionId }: { focusedSessionId: string | null }) {
  const [open, setOpen] = useState(false);
  // EPIC-P43: geöffnet aus „Mehr“ der Session (keine Randlasche mehr über dem Inhalt).
  useEffect(() => onLayerOpen("browser", () => setOpen(true)), []);
  const session = focusedSessionId ? getHubStatus().sessions.find((s) => s.id === focusedSessionId) : undefined;
  return (
    <>
      {open && <BrowserPanel sessionId={focusedSessionId} label={session ? (session.title ?? session.project.split("/").pop() ?? session.id.slice(0, 8)) : null} hostId={session?.hostId ?? null} onClose={() => setOpen(false)} />}
    </>
  );
}

export function BrowserPanel({ sessionId, label, hostId, onClose }: { sessionId: string | null; label: string | null; hostId: string | null; onClose: () => void }) {
  const [status, setStatus] = useState<BrowserStatus | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("view");
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const remote = Boolean(remoteHost(hostId));

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

  const refresh = () => {
    if (!sessionId || remote) return Promise.resolve();
    return hubApi.browserStatus(sessionId).then(setStatus).catch((err) => setError(err instanceof Error ? err.message : "Status nicht lesbar"));
  };
  useEffect(() => {
    void refresh();
    if (!sessionId || remote) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible" && navigator.onLine) void refresh(); }, 2000);
    return () => clearInterval(timer);
  }, [sessionId, remote]);

  const run = async (fn: () => Promise<BrowserStatus>) => {
    setBusy(true);
    setError("");
    try {
      setStatus(await fn());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Aktion fehlgeschlagen");
      void refresh();
    } finally {
      setBusy(false);
    }
  };

  const head = (
    <div class="browser-head">
      <strong>Browser</strong>
      <span class="dim" data-testid="browser-context">
        {sessionId ? `Session „${label ?? sessionId.slice(0, 8)}“ · ${remote ? "andere Maschine" : "dieser Host"}` : "keine Session fokussiert"}
      </span>
      {sessionId && !remote && (
        <button
          type="button"
          class="chip"
          aria-label="Browser in eigenes Fenster"
          title="In eigenes Fenster"
          onClick={() => void openPopout({ kind: "browser", sessionId, ...(remoteHost(hostId) ? { hostId: remoteHost(hostId)! } : {}) })}
        >
          ⧉
        </button>
      )}
      <button type="button" class="chip" onClick={onClose} aria-label="Browser schließen">×</button>
    </div>
  );
  if (!sessionId) return <aside class="browser-panel" data-testid="browser-panel">{head}<div class="empty">Zuerst eine Session fokussieren — der Browser gehört zu ihrem Workspace.</div></aside>;
  if (remote) return <aside class="browser-panel" data-testid="browser-panel">{head}<div class="files-error" role="status">Der Browser läuft auf dem Host der Session. Für Sessions anderer Maschinen ist er in dieser Version nicht erreichbar.</div></aside>;

  const isOpen = status?.state === "open";
  return (
    <aside class="browser-panel" data-testid="browser-panel" aria-label="Browser-Arbeitsplatz">
      {head}
      {status?.state === "unavailable" && <div class="files-error" role="alert" data-testid="browser-unavailable">Browser nicht verfügbar: {status.unavailableReason}</div>}
      {error && <div class="files-error" role="alert">{error}</div>}
      {!online && <div class="files-stale" role="status">Offline — letztes Bild mit Zeitstempel, Eingabe gesperrt.</div>}
      <div class="browser-bar">
        <UrlBar status={status} disabled={busy || !online} onOpen={(url) => run(() => hubApi.browserOpen(sessionId, url || undefined))} onNavigate={(url) => run(() => (isOpen ? hubApi.browserAction(sessionId, { type: "navigate", url }) : hubApi.browserOpen(sessionId, url)))} />
        {isOpen && (
          <>
            <button type="button" class="chip" disabled={busy || !online || !status.canBack} aria-label="Zurück" onClick={() => run(() => hubApi.browserAction(sessionId, { type: "back" }))}>‹</button>
            <button type="button" class="chip" disabled={busy || !online || !status.canForward} aria-label="Vor" onClick={() => run(() => hubApi.browserAction(sessionId, { type: "forward" }))}>›</button>
            <button type="button" class="chip" disabled={busy || !online} aria-label="Neu laden" onClick={() => run(() => hubApi.browserAction(sessionId, { type: "reload" }))}>↻</button>
            <label class="dim" title="Fenstergröße des Host-Browsers — kein Gerätesimulator">
              Fenster{" "}
              <select aria-label="Fenstergröße" value={status.viewport} disabled={busy || !online} onChange={(e) => run(() => hubApi.browserAction(sessionId, { type: "viewport", preset: (e.target as HTMLSelectElement).value as BrowserViewportName }))}>
                <option value="desktop">Desktop 1280×800</option>
                <option value="tablet">Tablet 820×1180</option>
                <option value="phone">Schmal 390×844</option>
              </select>
            </label>
            <button type="button" class="chip" onClick={() => run(() => hubApi.browserClose(sessionId))}>Schließen</button>
          </>
        )}
      </div>
      {status && <div class="dim" data-testid="browser-mode">{status.headless ? "Modus: unsichtbar (headless) — du siehst das Bild hier." : "Modus: sichtbares Chromium-Fenster auf dem Host — das Bild hier ist dasselbe Fenster."}</div>}
      {status && status.allowedOrigins.length > 0 && <div class="dim browser-origins" data-testid="browser-origins">Erreichbar: {status.allowedOrigins.join(", ")}</div>}
      {status && status.allowedOrigins.length === 0 && <div class="dim">Kein freigegebenes Ziel: der Workspace hat keinen laufenden Service (Manifest) und es sind keine browserOrigins konfiguriert.</div>}
      <div class="browser-tabs" role="tablist">
        {(["view", "tests", "log"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} class={tab === t ? "chip active" : "chip"} onClick={() => setTab(t)}>
            {t === "view" ? "Ansicht" : t === "tests" ? "Tests" : `Konsole${status?.log.length ? ` (${status.log.length})` : ""}`}
          </button>
        ))}
      </div>
      {tab === "view" && <Viewport sessionId={sessionId} status={status} online={online} busy={busy} onStatus={setStatus} onError={setError} />}
      {tab === "tests" && <Tests sessionId={sessionId} online={online} />}
      {tab === "log" && (
        <ul class="browser-log" data-testid="browser-log">
          {(status?.log ?? []).map((l, k) => <li key={k} class={`log-${l.kind}`}><span class="dim">{l.kind}</span> {l.text}</li>)}
          {(status?.log.length ?? 0) === 0 && <li class="dim">Keine Console-/Netzfehler.</li>}
        </ul>
      )}
    </aside>
  );
}

function UrlBar({ status, disabled, onOpen, onNavigate }: { status: BrowserStatus | null; disabled: boolean; onOpen: (url: string) => void; onNavigate: (url: string) => void }) {
  const [text, setText] = useState("");
  useEffect(() => { if (status?.url) setText(status.url); }, [status?.url]);
  return (
    <form class="browser-url" onSubmit={(e) => { e.preventDefault(); if (text.trim()) onNavigate(text.trim()); else onOpen(""); }}>
      <input aria-label="Adresse" placeholder="/pfad oder http://127.0.0.1:PORT/" value={text} disabled={disabled} onInput={(e) => setText((e.target as HTMLInputElement).value)} />
      <button type="submit" class="btn" disabled={disabled}>{status?.state === "open" ? "Gehe zu" : "Browser starten"}</button>
    </form>
  );
}

function Viewport({ sessionId, status, online, busy, onStatus, onError }: { sessionId: string; status: BrowserStatus | null; online: boolean; busy: boolean; onStatus: (s: BrowserStatus) => void; onError: (m: string) => void }) {
  const [frame, setFrame] = useState<{ url: string; at: Date } | null>(null);
  const [mode, setMode] = useState<"operate" | "pick">("operate");
  const [pick, setPick] = useState<BrowserPick | null>(null);
  const [typed, setTyped] = useState("");
  const img = useRef<HTMLImageElement>(null);
  const isOpen = status?.state === "open";

  useEffect(() => {
    if (!isOpen) { setFrame(null); return; }
    let alive = true;
    let last: string | null = null;
    const tick = async () => {
      if (!alive || document.visibilityState !== "visible" || !navigator.onLine) return;
      try {
        const url = await hubApi.browserFrame(sessionId);
        if (!alive) { if (url) URL.revokeObjectURL(url); return; }
        if (url) {
          if (last) URL.revokeObjectURL(last);
          last = url;
          setFrame({ url, at: new Date() });
        }
      } catch { /* nächster Tick; Offline-Zustand zeigt das letzte Bild */ }
    };
    void tick();
    const timer = setInterval(tick, 500);
    return () => { alive = false; clearInterval(timer); if (last) URL.revokeObjectURL(last); };
  }, [sessionId, isOpen]);

  const act = (action: Parameters<typeof hubApi.browserAction>[1]) => hubApi.browserAction(sessionId, action).then(onStatus).catch((err) => onError(err instanceof Error ? err.message : "Aktion fehlgeschlagen"));

  const onImageClick = async (e: MouseEvent) => {
    const el = img.current;
    if (!el || !online) return;
    const rect = el.getBoundingClientRect();
    const point = toViewportPoint({ x: e.clientX, y: e.clientY }, rect, { width: el.naturalWidth, height: el.naturalHeight });
    if (!point) return;
    if (mode === "pick") {
      try { setPick(await hubApi.browserPick(sessionId, point.x, point.y)); } catch (err) { onError(err instanceof Error ? err.message : "Auswahl fehlgeschlagen"); }
    } else await act({ type: "click", x: point.x, y: point.y });
  };

  if (!isOpen) return <div class="empty" data-testid="browser-closed">Der Browser ist geschlossen. Adresse eingeben und „Browser starten“.</div>;
  return (
    <div class="browser-view">
      <div class="browser-tools">
        <label class="dim"><input type="radio" name="browser-mode" checked={mode === "operate"} onChange={() => setMode("operate")} /> Bedienen</label>
        <label class="dim"><input type="radio" name="browser-mode" checked={mode === "pick"} onChange={() => setMode("pick")} /> Element wählen</label>
        <button type="button" class="chip" disabled={!online} onClick={() => act({ type: "scroll", dy: -400 })} aria-label="Hochscrollen">↑</button>
        <button type="button" class="chip" disabled={!online} onClick={() => act({ type: "scroll", dy: 400 })} aria-label="Runterscrollen">↓</button>
        {(["Enter", "Tab", "Escape", "Backspace"] as const).map((k) => <button key={k} type="button" class="chip" disabled={!online} onClick={() => act({ type: "press", key: k })}>{k}</button>)}
        <button type="button" class="chip" disabled={!frame} onClick={async () => { const u = await hubApi.browserBlobUrl(`/api/sessions/${sessionId}/browser/screenshot`); const a = document.createElement("a"); a.href = u; a.download = "browser.png"; a.click(); setTimeout(() => URL.revokeObjectURL(u), 10_000); }}>Screenshot</button>
      </div>
      <form class="browser-type" onSubmit={(e) => { e.preventDefault(); if (typed) { void act({ type: "type", text: typed }); setTyped(""); } }}>
        <input aria-label="Text eintippen" placeholder="Text in das fokussierte Feld tippen" value={typed} disabled={!online || busy} maxLength={500} onInput={(e) => setTyped((e.target as HTMLInputElement).value)} />
        <button type="submit" class="btn" disabled={!online || !typed}>Tippen</button>
      </form>
      {frame ? (
        <img ref={img} class={mode === "pick" ? "browser-frame picking" : "browser-frame"} data-testid="browser-frame" src={frame.url} alt={`Browser: ${status?.title ?? status?.url ?? ""}`} onClick={onImageClick} draggable={false} />
      ) : <div class="empty">Bild wird geladen …</div>}
      {frame && <div class="dim" data-testid="browser-frame-time">Stand {frame.at.toLocaleTimeString("de-DE")}{!online ? " (offline)" : ""}</div>}
      {pick && <PickCard sessionId={sessionId} pick={pick} onDone={() => setPick(null)} />}
    </div>
  );
}

function PickCard({ sessionId, pick, onDone }: { sessionId: string; pick: BrowserPick; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [shot, setShot] = useState(true);
  const [preview, setPreview] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const input = { pick, note, includeScreenshot: shot };
  return (
    <div class="browser-pick" data-testid="browser-pick">
      <div><strong>&lt;{pick.tag}&gt;</strong> <span class="mono">{pick.selector}</span></div>
      {pick.masked && <div class="files-stale" role="status">Passwort-/Secret-Feld: Text und Styles werden nicht exportiert.</div>}
      {pick.frame === "iframe" && <div class="dim">Frame: nur das Frame-Element, sein Inhalt wird nicht ausgelesen.</div>}
      {pick.inShadowDom && <div class="dim">Element liegt im Shadow DOM.</div>}
      <div class="dim">Quelle: {pick.source ?? "nicht ermittelt (keine Source-Map ausgewertet)"}</div>
      {!pick.masked && pick.text && <div class="dim">Text: „{pick.text}“</div>}
      <input aria-label="Anmerkung zum Element" placeholder="Was soll geändert werden?" maxLength={2000} value={note} onInput={(e) => { setNote((e.target as HTMLInputElement).value); setPreview(null); }} />
      <label class="dim"><input type="checkbox" checked={shot} onChange={(e) => { setShot((e.target as HTMLInputElement).checked); setPreview(null); }} /> Screenshot des Elements anhängen</label>
      <div class="file-tools">
        <button type="button" class="btn" data-testid="browser-feedback-preview" onClick={() => hubApi.browserFeedbackPreview(sessionId, input).then((r) => setPreview(r.prompt)).catch((e) => setMsg(e instanceof Error ? e.message : "Vorschau fehlgeschlagen"))}>Vorschau</button>
        <button type="button" class="btn" data-testid="browser-feedback-send" disabled={!preview} onClick={() => hubApi.browserFeedbackSend(sessionId, { ...input, operationId: crypto.randomUUID() }).then(() => { setMsg("Gesendet."); onDone(); }).catch((e) => setMsg(e instanceof Error ? e.message : "Senden fehlgeschlagen"))}>An Session senden</button>
        <button type="button" class="chip" onClick={onDone}>Verwerfen</button>
      </div>
      {preview && <pre class="file-text" data-testid="browser-feedback-prompt">{preview}</pre>}
      {msg && <div class="dim" role="status">{msg}</div>}
    </div>
  );
}

function Tests({ sessionId, online }: { sessionId: string; online: boolean }) {
  const [runs, setRuns] = useState<BrowserTestRun[]>([]);
  const [text, setText] = useState(EXAMPLE_TEST);
  const [error, setError] = useState("");
  const [artifact, setArtifact] = useState<{ runId: string; url: string } | null>(null);
  const load = () => hubApi.browserTests(sessionId).then((r) => setRuns(r.runs)).catch(() => undefined);
  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (navigator.onLine) void load(); }, 1500);
    return () => clearInterval(timer);
  }, [sessionId]);
  useEffect(() => () => { if (artifact) URL.revokeObjectURL(artifact.url); }, [artifact]);

  const start = async () => {
    const parsed = parseTestCase(text);
    if (!parsed.ok) return setError(parsed.error);
    setError("");
    try { await hubApi.browserRunTest(sessionId, parsed.test); void load(); } catch (err) { setError(err instanceof Error ? err.message : "Start fehlgeschlagen"); }
  };
  return (
    <div class="browser-tests" data-testid="browser-tests">
      <div class="dim file-note">Registrierte Schritte (goto, click, fill, expectText, expectVisible, expectUrl) — kein freier Code. Der Test läuft in einem eigenen Kontext, getrennt von deinem Browser. Ein „/pfad“ gilt relativ zum ersten freigegebenen Dienst.</div>
      <textarea class="browser-test-editor mono" aria-label="Testfall (JSON)" rows={10} spellcheck={false} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
      {error && <div class="files-error" role="alert">{error}</div>}
      <button type="button" class="btn" disabled={!online} data-testid="browser-test-start" onClick={start}>Test starten</button>
      <ul class="browser-runs">
        {runs.map((r) => (
          <li key={r.id} data-testid="browser-run" data-state={r.state}>
            <strong>{r.name}</strong> · <span class={`run-${r.state}`}>{TEST_STATE_LABEL[r.state]}</span> <span class="dim">({r.viewport})</span>
            {r.state === "running" && <button type="button" class="chip" onClick={() => hubApi.browserAbortTest(sessionId, r.id).then(load)}>Abbrechen</button>}
            {r.note && <div class="dim">{r.note}</div>}
            <ol class="dim">{r.steps.map((s) => <li key={s.index}>{s.ok ? "✓" : "✗"} {s.type}{s.detail ? ` — ${s.detail}` : ""}</li>)}</ol>
            {r.artifact && <button type="button" class="chip" onClick={async () => setArtifact({ runId: r.id, url: await hubApi.browserBlobUrl(`/api/sessions/${sessionId}/browser/tests/${r.id}/artifact`) })}>Screenshot</button>}
            {artifact?.runId === r.id && <img class="file-media" src={artifact.url} alt={`Screenshot von ${r.name}`} />}
          </li>
        ))}
        {runs.length === 0 && <li class="dim">Noch keine Testläufe.</li>}
      </ul>
    </div>
  );
}
