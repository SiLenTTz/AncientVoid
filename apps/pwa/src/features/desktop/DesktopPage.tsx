import { useEffect, useRef, useState } from "preact/hooks";
import { hubApi, type CompanionState, type DesktopAction } from "../../shared/api.ts";
import { LocalRecorder, recordingSupported, sttStatus, transcribe } from "../../shared/local-stt.ts";

/**
 * EPIC-P11 (ADR-0031): type on the PC from the phone. The page shows which
 * window has the focus there; "Eintippen" sends exactly that window as the
 * target — if the focus moved meanwhile, the hub says so and nothing is typed.
 */
const STATUS: Record<DesktopAction["status"], string> = {
  pending: "wartet",
  delivered: "abgeholt",
  running: "tippt…",
  done: "fertig",
  failed: "gestoppt",
  refused: "abgelehnt",
  cancelled: "abgebrochen",
  expired: "verfallen",
  uncertain: "ungewiss",
};
const KEYS: { key: string; label: string }[] = [
  { key: "Return", label: "↵ Enter" },
  { key: "Tab", label: "Tab" },
  { key: "Escape", label: "Esc" },
  { key: "undo", label: "Rückgängig" },
];

export function DesktopPage() {
  const [companions, setCompanions] = useState<CompanionState[] | null>(null);
  const [actions, setActions] = useState<DesktopAction[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stt, setStt] = useState(false);
  const [recording, setRecording] = useState(false);
  const rec = useRef<LocalRecorder | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = () =>
      hubApi
        .desktop()
        .then((d) => {
          if (!alive) return;
          setCompanions(d.companions);
          setActions(d.actions);
        })
        .catch((err: unknown) => alive && setError(err instanceof Error ? err.message : "nicht erreichbar"));
    void tick();
    const timer = setInterval(() => void tick(), 1000);
    void sttStatus().then((s) => setStt(s.available && recordingSupported()));
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const c = companions?.find((x) => x.name === chosen) ?? companions?.find((x) => x.online) ?? companions?.[0] ?? null;
  const ready = Boolean(c?.online && c.focus && !c.locked && !c.paused && !c.blocked);

  const send = async (kind: "insert" | "replace" | "key", key?: string) => {
    if (!c?.focus) return;
    setBusy(true);
    setError("");
    try {
      // The target is the window shown right now — nothing else.
      const a = await hubApi.desktopAction({ companion: c.name, kind, ...(kind === "key" ? { key: key! } : { text }), target: { id: c.focus.id, revision: c.focus.revision } });
      setActions((all) => [a, ...all]);
      if (kind !== "key") setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "abgelehnt");
    } finally {
      setBusy(false);
    }
  };

  const dictate = async () => {
    if (recording && rec.current) {
      const r = rec.current;
      rec.current = null;
      setRecording(false);
      try {
        const t = await transcribe(await r.stop(), r.stoppedAt);
        if (t.text) setText((v) => (v ? `${v} ${t.text}` : t.text));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Spracherkennung fehlgeschlagen");
      }
      return;
    }
    try {
      const r = new LocalRecorder();
      await r.start(() => void dictate());
      rec.current = r;
      setRecording(true);
    } catch {
      setError("Mikrofon-Zugriff verweigert.");
    }
  };

  if (companions === null) return <div class="empty">lade…</div>;
  if (companions.length === 0)
    return (
      <div class="card desktop-setup">
        <h2>Am PC eintippen</h2>
        <p>Kein PC verbunden. So richtest du den Companion ein (auf dem PC):</p>
        <pre class="desktop-cmd">{"node apps/hubctl/src/cli.ts token issue companion:mein-pc > ~/.config/uacc/companion.token\nnode apps/companion/src/cli.ts run --hub http://127.0.0.1:7373"}</pre>
        <p class="dim">Not-Stopp am PC: „uacc-companion stop“ (z. B. auf Super+Shift+Esc legen).</p>
      </div>
    );

  return (
    <div class="desktop-page">
      <div class="card desktop-target">
        {companions.length > 1 && (
          <select aria-label="PC" value={c?.name ?? ""} onChange={(e) => setChosen((e.target as HTMLSelectElement).value)}>
            {companions.map((x) => (
              <option key={x.name} value={x.name}>
                {x.name} {x.online ? "" : "(offline)"}
              </option>
            ))}
          </select>
        )}
        <div class="desktop-head">
          <strong>{c?.name}</strong>
          <span class={`chip ${c?.online ? "ok" : "subtle"}`}>{c?.online ? "verbunden" : "offline"}</span>
          <span class="dim">{c?.backend}</span>
        </div>
        <div class="desktop-focus" aria-live="polite">
          Ziel: {c?.focus ? (
            <>
              <strong>{c.focus.app}</strong> — {c.focus.title}
            </>
          ) : (
            "kein Fenster im Fokus"
          )}
        </div>
        {c?.paused && <div class="reply-error">Not-Stopp am PC aktiv — dort mit „uacc-companion resume“ freigeben.</div>}
        {c?.locked && <div class="reply-error">Bildschirm am PC gesperrt.</div>}
        {c?.blocked && <div class="reply-error">{c.blocked}</div>}
      </div>

      <div class="card desktop-input">
        <textarea rows={4} value={text} placeholder="Text, der am PC ins fokussierte Feld getippt wird" aria-label="Text für den PC" maxLength={2000} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
        <div class="row" style="gap: 8px; flex-wrap: wrap">
          <button class="btn primary" type="button" disabled={!ready || busy || !text.trim()} onClick={() => void send("insert")}>
            Eintippen
          </button>
          <button class="btn" type="button" disabled={!ready || busy || !text.trim()} onClick={() => void send("replace")} title="Feldinhalt markieren (Strg+A) und ersetzen">
            Ersetzen
          </button>
          {stt && (
            <button class="btn" type="button" onClick={() => void dictate()}>
              {recording ? "Stopp" : "Diktieren"}
            </button>
          )}
        </div>
        <div class="row desktop-keys" style="gap: 6px; flex-wrap: wrap">
          {KEYS.map((k) => (
            <button key={k.key} class="btn subtle" type="button" disabled={!ready || busy} onClick={() => void send("key", k.key)}>
              {k.label}
            </button>
          ))}
        </div>
        {error && <div class="reply-error">{error}</div>}
      </div>

      {actions.length > 0 && (
        <div class="card desktop-actions">
          {actions.slice(0, 6).map((a) => (
            <div key={a.id} class={`desktop-action ${a.status}`}>
              <span class="chip">{STATUS[a.status]}</span> {a.kind === "key" ? `Taste ${a.key}` : `${a.textLength} Zeichen`} → {a.target.app}
              {a.detail && <div class="dim">{a.detail}</div>}
              {(a.status === "running" || a.status === "delivered" || a.status === "pending") && (
                <button class="btn subtle" type="button" onClick={() => void hubApi.cancelDesktopAction(a.id)}>
                  Abbrechen
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
