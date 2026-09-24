import { useEffect, useState } from "preact/hooks";
import { hubApi, type PushState } from "../../shared/api.ts";
import { pushSupport, readPrefs, subscribeThisDevice, unsubscribeThisDevice, writePrefs } from "../../shared/push.ts";

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const minutes = (v: string) => {
  const [h, m] = v.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "");

/**
 * T8.3 (ADR-0026): push notifications — off until you turn them on; the
 * inbox (bell) stays the complete list. Delivery status per device visible.
 */
export function PushSettings() {
  const [state, setState] = useState<PushState | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [prefs, setPrefs] = useState(readPrefs);
  const support = pushSupport();

  const load = () =>
    hubApi
      .push()
      .then(setState)
      .catch((err) => setError(err instanceof Error ? err.message : "Push-Status nicht ladbar"));
  useEffect(() => {
    void load();
  }, []);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setError("");
    setInfo("");
    try {
      await fn();
      if (ok) setInfo(ok);
    } catch (err) {
      setError(err instanceof Error ? err.message : "fehlgeschlagen");
    }
    await load();
  };

  const mine = state?.subscriptions.filter((s) => s.mine && !s.gone) ?? [];
  const save = (p: typeof prefs) => {
    setPrefs(p);
    writePrefs(p);
  };

  return (
    <div class="card form-grid push-settings">
      <h2 style="margin: 0">Benachrichtigungen</h2>
      <p class="dim" style="margin: 0">
        Push geht über den Dienst des Browser-Herstellers (Google, Apple, Mozilla, Microsoft) und verlässt damit das Tailnet. Übertragen wird nur eine Kennung — kein Prompt, kein Befehl, nichts auf dem Sperrbildschirm außer „Freigabe nötig“, „Fehler“ oder „Zug fertig“. Die Glocke bleibt die vollständige Liste.
      </p>
      {error && <div class="reply-error">{error}</div>}
      {info && <div class="dim">{info}</div>}
      {state && (
        <label class="row" style="justify-content: flex-start; gap: 8px">
          <input type="checkbox" checked={state.enabled} onChange={(e) => void run(() => hubApi.setPushEnabled((e.target as HTMLInputElement).checked))} />
          Push auf diesem Hub erlauben
        </label>
      )}
      {state?.enabled && (
        <>
          {support === "unsupported" && <div class="push-status warn">Dieser Browser kann hier kein Push. Auf dem iPhone: UACC erst „Zum Home-Bildschirm“ hinzufügen und von dort öffnen.</div>}
          {support === "denied" && <div class="push-status err">Benachrichtigungen sind für diese Seite blockiert — in den Browser- bzw. Geräteeinstellungen erlauben.</div>}
          {support === "ok" && (
            <div class="row" style="gap: 8px; flex-wrap: wrap; justify-content: flex-start">
              {mine.length === 0 ? (
                <button class="btn primary" type="button" onClick={() => void run(() => subscribeThisDevice(state.publicKey!), "Dieses Gerät bekommt jetzt Push.")}>
                  Auf diesem Gerät einschalten
                </button>
              ) : (
                <>
                  <button class="btn" type="button" onClick={() => void run(async () => {
                    const r = await hubApi.pushTest();
                    if (r.sent === 0) throw new Error(r.errors[0] ?? "Nicht zugestellt.");
                  }, "Test gesendet — kommt er an?")}>
                    Test senden
                  </button>
                  <button class="btn" type="button" onClick={() => void run(unsubscribeThisDevice, "Push auf diesem Gerät aus.")}>
                    Auf diesem Gerät aus
                  </button>
                </>
              )}
            </div>
          )}
          <label class="row" style="justify-content: flex-start; gap: 8px">
            <input type="checkbox" checked={prefs.done} onChange={(e) => save({ ...prefs, done: (e.target as HTMLInputElement).checked })} />
            Auch wenn ein Zug fertig ist (sonst nur Freigaben und Fehler)
          </label>
          <label class="row" style="justify-content: flex-start; gap: 8px; flex-wrap: wrap">
            <input type="checkbox" checked={prefs.quiet !== null} onChange={(e) => save({ ...prefs, quiet: (e.target as HTMLInputElement).checked ? { from: 22 * 60, to: 7 * 60 } : null })} />
            Ruhezeit
            {prefs.quiet && (
              <>
                <input type="time" aria-label="Ruhe ab" value={hhmm(prefs.quiet.from)} onInput={(e) => save({ ...prefs, quiet: { ...prefs.quiet!, from: minutes((e.target as HTMLInputElement).value) } })} />
                bis
                <input type="time" aria-label="Ruhe bis" value={hhmm(prefs.quiet.to)} onInput={(e) => save({ ...prefs, quiet: { ...prefs.quiet!, to: minutes((e.target as HTMLInputElement).value) } })} />
              </>
            )}
          </label>
          {mine.length > 0 && support === "ok" && (
            <button class="btn" type="button" onClick={() => void run(() => subscribeThisDevice(state.publicKey!), "Einstellungen übernommen.")}>
              Einstellungen für dieses Gerät übernehmen
            </button>
          )}
          {state.subscriptions.length > 0 && (
            <div class="push-devices">
              {state.subscriptions.map((s) => (
                <div key={s.id} class={`push-device ${s.gone ? "gone" : s.lastError ? "failed" : ""}`}>
                  <strong>{s.device ?? "Gerät"}</strong>
                  {s.mine ? " (dieses)" : ""} · {s.service}
                  <div class="dim">
                    {s.gone
                      ? s.lastError
                      : s.lastError
                        ? `Zustellung fehlgeschlagen ${when(s.lastErrorAt)}: ${s.lastError}`
                        : s.lastOkAt
                          ? `zuletzt zugestellt ${when(s.lastOkAt)}`
                          : "noch nichts gesendet"}
                    {s.quiet ? ` · Ruhe ${hhmm(s.quiet.from)}–${hhmm(s.quiet.to)}` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
