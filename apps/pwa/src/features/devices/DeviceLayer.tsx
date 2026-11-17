import { useEffect, useRef, useState } from "preact/hooks";
import type { AdbDeviceEntry, DeviceStatus } from "@ancientvoid/contracts";
import { hubApi, remoteHost } from "../../shared/api.ts";
import { openPopout } from "../windows/windows.ts";
import { getHubStatus } from "../shell/hub-status.ts";
import { onLayerOpen } from "../../shared/layers.ts";
import { ADB_STATE_LABEL, EMU_STATE_LABEL, EXAMPLE_TEST, TEST_STATE_LABEL, parseTestCase, toDevicePoint } from "./device-model.ts";
import { Button, Chip } from "../../shared/ui/index.ts";

type Tab = "view" | "tests" | "logs" | "tree";

/**
 * EPIC-P42 (ADR-0067): Geräte-Panel. AV-eigene Emulatoren werden sichtbar gestartet/gestoppt und über eine
 * Lease mit Generation bedient; jeder Tap trägt die Geometrie-Version des angezeigten Bildes — veraltete Bilder
 * treffen nie falsche Punkte. Physische/fremde Geräte werden erklärt, aber nicht gesteuert.
 */
export function DeviceLayer({ focusedSessionId }: { focusedSessionId: string | null }) {
  const [open, setOpen] = useState(false);
  // EPIC-P43: geöffnet aus „Mehr“ der Session (keine Randlasche mehr über dem Inhalt).
  useEffect(() => onLayerOpen("devices", () => setOpen(true)), []);
  const session = focusedSessionId ? getHubStatus().sessions.find((s) => s.id === focusedSessionId) : undefined;
  return (
    <>
      {open && (
        <DevicePanel
          sessionId={focusedSessionId}
          label={session ? (session.title ?? session.project.split("/").pop() ?? session.id.slice(0, 8)) : null}
          hostId={session?.hostId ?? null}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function DevicePanel({ sessionId, label, hostId, onClose }: { sessionId: string | null; label: string | null; hostId: string | null; onClose: () => void }) {
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("view");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [generation, setGeneration] = useState<number | null>(null);
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

  const refresh = () => hubApi.devicesStatus().then(setStatus).catch((err) => setError(err instanceof Error ? err.message : "Status nicht lesbar"));
  useEffect(() => {
    if (remote) return;
    void refresh();
    const timer = setInterval(() => { if (document.visibilityState === "visible" && navigator.onLine) void refresh(); }, 2500);
    return () => clearInterval(timer);
  }, [remote]);

  const run = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    setError("");
    try {
      return await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Aktion fehlgeschlagen");
      void refresh();
      return null;
    } finally {
      setBusy(false);
    }
  };

  const head = (
    <div class="browser-head">
      <strong>Android-Geräte</strong>
      <span class="dim" data-testid="device-context">
        {remote ? "andere Maschine" : "dieser Host"}{sessionId ? ` · Lease an „${label ?? sessionId.slice(0, 8)}“` : " · ohne Session (Lease/Tests brauchen eine fokussierte Session)"}
      </span>
      <Chip aria-label="Geräte in eigenes Fenster" title="In eigenes Fenster" onClick={() => void openPopout({ kind: "device" })}>⧉</Chip>
      <Chip onClick={onClose} aria-label="Geräte schließen">×</Chip>
    </div>
  );
  if (remote) return <aside class="browser-panel device-panel" data-testid="device-panel">{head}<div class="files-error" role="status">Die Testgeräte laufen auf dem Host der Session. Für Sessions anderer Maschinen sind sie nicht erreichbar.</div></aside>;

  const owned = (status?.devices ?? []).filter((d) => d.owned && d.instance);
  const lease = status?.leases.find((l) => l.serial === selected) ?? null;

  const startOrStop = async (fn: () => Promise<unknown>) => {
    await run(fn);
    void refresh();
  };

  return (
    <aside class="browser-panel device-panel" data-testid="device-panel" aria-label="Android-Testgeräte">
      {head}
      {status && !status.capabilities.ready && (
        <div class="files-error" role="alert" data-testid="device-unavailable">
          Nicht bereit: {status.capabilities.reasons.join(" ") || "unbekannter Grund"}
        </div>
      )}
      {error && <div class="files-error" role="alert">{error}</div>}
      {!online && <div class="files-stale" role="status">Offline — kein Start/Stop und keine Eingaben.</div>}
      <div class="device-bar">
        <label class="dim" title="AVD im AVD-Home des Hubs (devices.avdHome)">
          AVD{" "}
          <select aria-label="AVD wählen" disabled={busy || !online} data-testid="device-avd">
            {(status?.avds ?? []).map((a) => <option key={a.name} value={a.name} disabled={!a.allowed}>{a.name}{a.lcdWidth ? ` (${a.lcdWidth}×${a.lcdHeight})` : ""}{a.allowed ? "" : " — gesperrt"}</option>)}
          </select>
        </label>
        <Button
          data-testid="device-start"
          disabled={busy || !online || (status?.avds.length ?? 0) === 0 || !status?.capabilities.ready}
          onClick={(e) => {
            const avd = ((e.currentTarget.closest(".device-bar")?.querySelector("select") as HTMLSelectElement | null)?.value ?? "").trim();
            if (avd) void startOrStop(() => hubApi.deviceStart(avd, sessionId));
          }}
        >
          Emulator starten
        </Button>
      </div>
      <ul class="device-list" data-testid="device-list">
        {(status?.devices ?? []).map((d) => (
          <li key={d.serial} class="device-row" data-testid="device-row" data-serial={d.serial}>
            <Chip  onClick={() => setSelected(d.serial)} active={selected === d.serial}>
              <span class="mono">{d.serial}</span>
            </Chip>
            <span class={`run-${d.instance?.state ?? (d.state === "device" ? "ready" : "failed")}`} data-testid="device-state">
              {d.instance ? EMU_STATE_LABEL[d.instance.state] ?? d.instance.state : ADB_STATE_LABEL[d.state] ?? d.rawState}
            </span>
            {d.instance && <span class="dim">{d.instance.avdName}</span>}
            {d.physical && <span class="dim">physisch — nur sichtbar, keine Steuerung (EPIC-P42 Out)</span>}
            {d.foreignEmulator && <span class="dim">fremder Emulator — wird nie von AV beendet</span>}
            {d.state === "unauthorized" && <span class="dim">USB-Debugging bestätigen</span>}
            {d.owned && (
              <Chip data-testid="device-stop" disabled={busy || !online} onClick={() => void startOrStop(() => hubApi.deviceStop(d.serial))}>
                Beenden
              </Chip>
            )}
          </li>
        ))}
        {(status?.devices.length ?? 0) === 0 && <li class="dim">Keine Geräte — einen Emulator starten oder Gerät anstecken (nur sichtbar).</li>}
      </ul>
      {selected && (
        <>
          <div class="device-bar">
            <span class="mono dim" data-testid="device-selected">{selected}</span>
            {generation === null ? (
              <Button
                data-testid="device-lease"
                disabled={busy || !online || !sessionId || !owned.some((d) => d.serial === selected && d.instance?.state === "ready")}
                title={sessionId ? "Steuerungslease für dieses Gerät holen" : "Zuerst eine Session fokussieren"}
                onClick={() => void run(async () => { const r = await hubApi.deviceLease(selected, sessionId); setGeneration(r.generation); void refresh(); })}
              >
                Steuerung holen
              </Button>
            ) : (
              <>
                <span class="dim" data-testid="device-generation">Generation {generation}</span>
                <Chip disabled={busy || !online} onClick={() => void run(async () => { await hubApi.deviceRelease(selected, generation); setGeneration(null); void refresh(); })}>Freigeben</Chip>
              </>
            )}
            {lease && generation === null && <span class="files-stale" role="status">belegt von „{lease.owner}“</span>}
          </div>
          <div class="browser-tabs" role="tablist">
            {(["view", "tests", "logs", "tree"] as const).map((t) => (
              <Chip key={t} role="tab" aria-selected={tab === t}  onClick={() => setTab(t)} active={tab === t}>
                {t === "view" ? "Ansicht" : t === "tests" ? "Tests" : t === "logs" ? "Logs" : "Baum"}
              </Chip>
            ))}
          </div>
          {tab === "view" && <DeviceView serial={selected} generation={generation} online={online} busy={busy} onError={setError} />}
          {tab === "tests" && <Tests serial={selected} online={online} />}
          {tab === "logs" && <Logs serial={selected} online={online} />}
          {tab === "tree" && <Tree serial={selected} online={online} />}
        </>
      )}
    </aside>
  );
}

function DeviceView({ serial, generation, online, busy, onError }: { serial: string; generation: number | null; online: boolean; busy: boolean; onError: (m: string) => void }) {
  const [frame, setFrame] = useState<{ url: string; seq: number; geometryVersion: number; width: number; height: number; at: Date } | null>(null);
  const [typed, setTyped] = useState("");
  const [url, setUrl] = useState("");
  const [apk, setApk] = useState("");
  const img = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setFrame(null);
    let alive = true;
    let last: string | null = null;
    const tick = async () => {
      if (!alive || document.visibilityState !== "visible" || !navigator.onLine) return;
      try {
        const f = await hubApi.deviceFrame(serial);
        if (!alive) { if (f) URL.revokeObjectURL(f.url); return; }
        if (f) {
          if (last) URL.revokeObjectURL(last);
          last = f.url;
          setFrame({ ...f, at: new Date() });
        }
      } catch { /* nächster Tick; Offline zeigt das letzte Bild */}
    };
    void tick();
    const timer = setInterval(tick, 700);
    return () => { alive = false; clearInterval(timer); if (last) URL.revokeObjectURL(last); };
  }, [serial]);

  const act = (action: Parameters<typeof hubApi.deviceAction>[3], geoVersion: number) => {
    if (generation === null) { onError("Zuerst die Steuerung (Lease) holen."); return; }
    void hubApi.deviceAction(serial, generation, geoVersion, action).catch((err) => {
      const msg = err instanceof Error ? err.message : "Aktion fehlgeschlagen";
      onError(msg.includes("Generation") || msg.includes("veraltet") ? `${msg} — Bild aktualisiert sich gleich; erneut versuchen.` : msg);
    });
  };

  const onImageClick = (e: MouseEvent) => {
    const el = img.current;
    if (!el || !online || !frame || generation === null) return;
    const rect = el.getBoundingClientRect();
    const point = toDevicePoint({ x: e.clientX, y: e.clientY }, rect, { width: frame.width || el.naturalWidth, height: frame.height || el.naturalHeight });
    if (point) act({ type: "tap", x: point.x, y: point.y }, frame.geometryVersion);
  };

  const keys = ["back", "home", "app-switch", "enter", "del", "volume-up", "volume-down"] as const;
  return (
    <div>
      {generation === null && <div class="dim">Nur Ansicht — für Eingaben die Steuerung (Lease) holen. Jeder Tap wird an das angezeigte Bild gebunden.</div>}
      <div class="browser-tools">
        <Chip disabled={!online || generation === null} onClick={() => frame && act({ type: "swipe", x1: Math.round(frame.width / 2), y1: Math.round(frame.height * 0.7), x2: Math.round(frame.width / 2), y2: Math.round(frame.height * 0.3), durationMs: 300 }, frame.geometryVersion)} aria-label="Hochwischen">↑</Chip>
        <Chip disabled={!online || generation === null} onClick={() => frame && act({ type: "swipe", x1: Math.round(frame.width / 2), y1: Math.round(frame.height * 0.3), x2: Math.round(frame.width / 2), y2: Math.round(frame.height * 0.7), durationMs: 300 }, frame.geometryVersion)} aria-label="Runterwischen">↓</Chip>
        {keys.map((k) => <Chip key={k} disabled={!online || generation === null} onClick={() => frame && act({ type: "key", key: k }, frame.geometryVersion)}>{k}</Chip>)}
        <label class="dim"> Ausrichtung{" "}
          <select aria-label="Ausrichtung" disabled={!online || generation === null} onChange={(e) => frame && act({ type: "rotate", orientation: (e.target as HTMLSelectElement).value as "portrait" | "landscape" }, frame.geometryVersion)}>
            <option value="portrait">Hochformat</option>
            <option value="landscape">Querformat</option>
          </select>
        </label>
      </div>
      <form class="browser-type" onSubmit={(e) => { e.preventDefault(); if (typed && frame) { act({ type: "text", text: typed }, frame.geometryVersion); setTyped(""); } }}>
        <input aria-label="Text auf dem Gerät tippen" placeholder="ASCII-Text tippen (Leerzeichen erlaubt, % nicht)" value={typed} disabled={!online || busy || generation === null} maxLength={500} onInput={(e) => setTyped((e.target as HTMLInputElement).value)} />
        <Button type="submit" disabled={!online || !typed || generation === null}>Tippen</Button>
      </form>
      <form class="browser-url" onSubmit={(e) => { e.preventDefault(); if (url && frame) { act({ type: "openUrl", url }, frame.geometryVersion); setUrl(""); } }}>
        <input aria-label="URL im Emulator öffnen" placeholder="http://10.0.2.2:PORT/ (10.0.2.2 = Host-Loopback)" value={url} disabled={!online || generation === null} maxLength={2048} onInput={(e) => setUrl((e.target as HTMLInputElement).value)} />
        <Button type="submit" disabled={!online || !url || generation === null}>Öffnen</Button>
      </form>
      <details class="device-install">
        <summary class="dim">APK aus Session-Anhang installieren</summary>
        <form class="browser-type" onSubmit={(e) => { e.preventDefault(); if (apk && generation !== null) void hubApi.deviceInstall(serial, generation, apk.trim()).catch((err) => onError(err instanceof Error ? err.message : "Installation fehlgeschlagen")).finally(() => setApk("")); }}>
          <input aria-label="Anhang-ID (sha256)" placeholder="Anhang-ID (sha256) aus einem Session-Anhang" value={apk} disabled={!online || generation === null} maxLength={64} onInput={(e) => setApk((e.target as HTMLInputElement).value)} />
          <Button type="submit" disabled={!online || !apk || generation === null}>Installieren</Button>
        </form>
        <div class="dim">Nur referenzierte Artefakte mit Hash-Prüfung — keine URL-Downloads (EPIC-P42 §3.3).</div>
      </details>
      {frame ? (
        <img
          ref={img}
          class="browser-frame device-frame"
          data-testid="device-frame"
          src={frame.url}
          alt={`Gerätebild ${serial}`}
          onClick={onImageClick}
          draggable={false}
        />
      ) : (
        <div class="ui-empty" data-testid="device-noframe">Noch kein Bild — Gerät bereit? Standbild kommt alle 0,7 s.</div>
      )}
      {frame && <div class="dim" data-testid="device-frame-time">Stand {frame.at.toLocaleTimeString("de-DE")} · Seq {frame.seq} · Geometrie {frame.geometryVersion} · {frame.width}×{frame.height}px</div>}
    </div>
  );
}

function Logs({ serial, online }: { serial: string; online: boolean }) {
  const [text, setText] = useState("");
  const [meta, setMeta] = useState<{ truncated: boolean; at: string } | null>(null);
  const [auto, setAuto] = useState(false);
  const [error, setError] = useState("");
  const load = () => hubApi.deviceLogs(serial).then((r) => { setText(r.text); setMeta({ truncated: r.truncated, at: r.at }); }).catch((e) => setError(e instanceof Error ? e.message : "Logs nicht lesbar"));
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => { if (navigator.onLine && document.visibilityState === "visible") void load(); }, 10_000);
    return () => clearInterval(t);
  }, [auto, serial]);
  return (
    <div class="device-logs" data-testid="device-logs">
      <div class="file-tools">
        <Button disabled={!online} onClick={() => void load()}>Logcat laden</Button>
        <label class="dim"><input type="checkbox" checked={auto} onChange={(e) => setAuto((e.target as HTMLInputElement).checked)} /> alle 10 s</label>
        {meta && <span class="dim">{meta.at}{meta.truncated ? " · gekürzt" : ""}</span>}
      </div>
      {error && <div class="files-error" role="alert">{error}</div>}
      <pre class="file-text mono">{text || "Noch nicht geladen."}</pre>
    </div>
  );
}

function Tree({ serial, online }: { serial: string; online: boolean }) {
  const [xml, setXml] = useState("");
  const [error, setError] = useState("");
  const [at, setAt] = useState("");
  return (
    <div class="device-tree" data-testid="device-tree">
      <div class="file-tools">
        <Button
          disabled={!online}
          onClick={() => hubApi.deviceTree(serial).then((t) => { setXml(t); setAt(new Date().toISOString()); setError(""); }).catch((e) => setError(e instanceof Error ? e.message : "Baum nicht lesbar"))}
        >
          Accessibility-Baum laden
        </Button>
        {at && <span class="dim">{at}</span>}
      </div>
      {error && <div class="files-error" role="alert">{error}</div>}
      <pre class="file-text mono">{xml || "Noch nicht geladen."}</pre>
    </div>
  );
}

function Tests({ serial, online }: { serial: string; online: boolean }) {
  const [runs, setRuns] = useState<{ id: string; name: string; state: keyof typeof TEST_STATE_LABEL; steps: { index: number; type: string; ok: boolean; detail: string | null }[]; artifact: { name: string } | null; note: string | null; env: Record<string, unknown> }[]>([]);
  const [text, setText] = useState(EXAMPLE_TEST.replace('"emulator-5554"', JSON.stringify(serial)));
  const [error, setError] = useState("");
  const [artifact, setArtifact] = useState<{ runId: string; url: string } | null>(null);
  const load = () => hubApi.deviceTests(serial).then((r) => setRuns(r.runs)).catch(() => undefined);
  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (navigator.onLine) void load(); }, 2000);
    return () => clearInterval(timer);
  }, [serial]);
  useEffect(() => () => { if (artifact) URL.revokeObjectURL(artifact.url); }, [artifact]);

  const start = async () => {
    const parsed = parseTestCase(text);
    if (!parsed.ok) return setError(parsed.error);
    setError("");
    try { await hubApi.deviceRunTest(parsed.test); void load(); } catch (err) { setError(err instanceof Error ? err.message : "Start fehlgeschlagen"); }
  };
  return (
    <div  data-testid="device-tests">
      <div class="dim file-note">Registrierte Schritte (openUrl, tap, swipe, text, key, rotate, expectText, wait) — kein freier Code. Der Lauf hält selbst die Lease und hält Image/API/Auflösung fest. 10.0.2.2 ist der Host aus Emulatorsicht.</div>
      <textarea class="browser-test-editor mono" aria-label="Geräte-Testfall (JSON)" rows={10} spellcheck={false} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
      {error && <div class="files-error" role="alert">{error}</div>}
      <Button disabled={!online} data-testid="device-test-start" onClick={start}>Test starten</Button>
      <ul class="browser-runs">
        {runs.map((r) => (
          <li key={r.id} data-testid="device-run" data-state={r.state}>
            <strong>{r.name}</strong> · <span class={`run-${r.state}`}>{TEST_STATE_LABEL[r.state]}</span>
            {r.state === "running" && <Chip onClick={() => hubApi.deviceAbortTest(serial, r.id).then(load)}>Abbrechen</Chip>}
            {r.note && <div class="dim">{r.note}</div>}
            <div class="dim">API {String(r.env.apiVersion ?? "?")} · {r.env.resolution ? `${(r.env.resolution as { width: number; height: number }).width}×${(r.env.resolution as { width: number; height: number }).height}` : "?"} · {String(r.env.avdName ?? "?")}</div>
            <ol class="dim">{r.steps.map((s) => <li key={s.index}>{s.ok ? "✓" : "✗"} {s.type}{s.detail ? ` — ${s.detail}` : ""}</li>)}</ol>
            {r.artifact && <Chip onClick={async () => setArtifact({ runId: r.id, url: await hubApi.browserBlobUrl(`/api/devices/tests/${r.id}/artifact?serial=${encodeURIComponent(serial)}`) })}>Screenshot</Chip>}
            {artifact?.runId === r.id && <img class="file-media" src={artifact.url} alt={`Screenshot von ${r.name}`} />}
          </li>
        ))}
        {runs.length === 0 && <li class="dim">Noch keine Testläufe auf diesem Gerät.</li>}
      </ul>
    </div>
  );
}
