import { useEffect, useState } from "preact/hooks";
import { hubApi, type SessionRecord } from "../../shared/api.ts";
import { armFirstRun, dismissFirstSignal, FIRST_APPROVAL_EVENT, firstSignalPending } from "../../shared/first-run.ts";

/**
 * EPIC-P57 T57.9 (AC-P57-7): der Leerzustand eines frischen Hubs ist die Onboarding-Fläche — eine kurze Anweisung,
 * eine Probe-Session mit dem Testadapter (kein Provider nötig) und der Verweis aufs Tutorial. Keine Tour, kein Overlay.
 * Der Fortschritt ist Gerätezustand (first-run.ts), nie Hub-Wahrheit.
 */
export function StartGuide({ probeAvailable, onOpen }: { probeAvailable: boolean; onOpen: (session: SessionRecord) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Erst wer den Einstieg gesehen hat, bekommt später das Erfolgssignal.
  useEffect(armFirstRun, []);

  const startProbe = async () => {
    setBusy(true);
    setError("");
    try {
      const { projects } = await hubApi.projects();
      const project = projects[0]?.path;
      if (!project) {
        setError("Kein Projekt gefunden. Lege über „＋“ ein Projekt an oder trage projectRoots in hub.config.json ein.");
        return;
      }
      onOpen(await hubApi.createSession({ adapter: "dummy", project }));
    } catch (err) {
      setError(err instanceof Error ? `Probe-Session nicht gestartet: ${err.message}` : "Probe-Session nicht gestartet.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="card" aria-label="Erste Schritte">
      <h2 style="margin: 0">Noch keine Sessions</h2>
      <p style="margin: 0">
        {probeAvailable
          ? "Starte eine Probe-Session mit dem Testadapter (dummy) — dafür ist kein Provider nötig. Eine eigene Session legst du über „＋“ an."
          : "Lege über „＋“ deine erste Session an: Projekt und Provider wählen, Auftrag eingeben, starten."}
      </p>
      {probeAvailable && (
        <button type="button" class={busy ? "btn primary busy" : "btn primary"} aria-busy={busy} disabled={busy} onClick={() => void startProbe()}>
          Probe-Session (dummy)
        </button>
      )}
      {error && (
        <div class="reply-error" role="alert">
          {error}
        </div>
      )}
      <p class="dim" style="margin: 0">
        Ganze Anleitung bis zur ersten Freigabe vom Handy: <code>docs/tutorial-erste-schritte.md</code> im Repo.
      </p>
    </section>
  );
}

/** Einmaliges, schließbares Erfolgssignal nach der ersten entschiedenen Freigabe dieses Geräts. */
export function FirstSuccessSignal() {
  const [shown, setShown] = useState(firstSignalPending);
  useEffect(() => {
    const on = () => setShown(firstSignalPending());
    document.addEventListener(FIRST_APPROVAL_EVENT, on);
    return () => document.removeEventListener(FIRST_APPROVAL_EVENT, on);
  }, []);
  if (!shown) return null;
  return (
    <div class="card" role="status">
      <span>Freigabe entschieden — Agent läuft weiter.</span>{" "}
      <button
        type="button"
        class="link-btn"
        onClick={() => {
          dismissFirstSignal();
          setShown(false);
        }}
      >
        Schließen
      </button>
    </div>
  );
}
