import { useEffect, useRef, useState } from "preact/hooks";
import { speechRecognitionSupported, startContinuousStt, type ContinuousSttHandle } from "../../shared/speech.ts";
import { LocalRecorder, recordingSupported, sttStatus } from "../../shared/local-stt.ts";
import { pasteTranscript } from "./paste-target.ts";
import { registerShortcut } from "../../shared/shortcuts/registry.ts";

/** BUG-0157: Wie lange das Feedback nach dem Aufnahmeende sichtbar bleibt, bevor die Blende ausblendet. */
const FEEDBACK_HIDE_MS = 10_000;

/**
 * BUG-0177: Diktat soll auch nach einer Minute noch laufen — und nach fünf.
 * Früher endete die Browser-Erkennung nach 10 s von selbst (recognizeOnce mit
 * `continuous = false`), was als "bricht schon wieder ab" ankam. 15 Minuten sind
 * die obere Grenze, damit ein vergessenes Mikrofon nicht stundenlang mitläuft.
 */
const MAX_DICTATION_MS = 15 * 60_000;

type WakeLockSentinelLike = { release(): Promise<void>; addEventListener?(type: string, cb: () => void): void };

/**
 * Push-to-talk: nochmal tippen stoppt. Lokal (Hub/whisper) wenn konfiguriert,
 * sonst durchgehende Browser-Erkennung mit Wort-für-Wort-Vorschau.
 */
export function usePushToTalk() {
  const [localStt, setLocalStt] = useState<{ available: boolean; engine?: string; streaming?: boolean }>({ available: false });
  const [listening, setListening] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [partial, setPartial] = useState("");
  const [streamNotice, setStreamNotice] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [restarts, setRestarts] = useState(0);
  const recorder = useRef<LocalRecorder | null>(null);
  const handle = useRef<ContinuousSttHandle | null>(null);
  const capTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wake = useRef<WakeLockSentinelLike | null>(null);
  const secondsRef = useRef(0);

  useEffect(() => {
    void sttStatus().then(setLocalStt);
  }, []);

  const active = recording || listening;

  // BUG-0157: info/error dürfen nicht für alle Zeit stehen bleiben.
  useEffect(() => {
    if (active || (!info && !error)) return;
    const t = setTimeout(() => {
      setInfo("");
      setError("");
    }, FEEDBACK_HIDE_MS);
    return () => clearTimeout(t);
  }, [active, info, error]);

  // BUG-0177: Sekundenzähler — die UI zeigt damit belegt, dass die Erkennung lebt.
  useEffect(() => {
    if (!active) {
      secondsRef.current = 0;
      setSeconds(0);
      return;
    }
    const t = setInterval(() => {
      secondsRef.current += 1;
      setSeconds(secondsRef.current);
    }, 1000);
    return () => clearInterval(t);
  }, [active]);

  // BUG-0177: Wach-Riegel, damit das Handy die Erkennung nicht nach dem Display-Sleep
  // verschluckt. Kein Muss: ohne Unterstützung läuft die Diktation trotzdem weiter.
  useEffect(() => {
    if (!active) {
      const w = wake.current;
      wake.current = null;
      void w?.release().catch(() => undefined);
      return;
    }
    const nav = navigator as unknown as { wakeLock?: { request?(type: "screen"): Promise<WakeLockSentinelLike> } };
    void nav.wakeLock?.request?.("screen")
      .then((s) => {
        if (active) wake.current = s;
        else void s.release().catch(() => undefined);
      })
      .catch(() => undefined);
  }, [active]);

  // Harte Obergrenze statt stiller Kurz-Abbrüche: danach wird geschlossen und der
  // bis dahin gehörte Text eingefügt — niemand verliert ein minutenlanges Diktat.
  useEffect(() => {
    if (!active) return;
    capTimer.current = setTimeout(() => {
      setInfo(`15-Minuten-Grenze erreicht — Diktat wird abgeschlossen.`);
      if (handle.current) handle.current.stop();
      else if (recorder.current) void stopLocal();
    }, MAX_DICTATION_MS);
    return () => {
      if (capTimer.current) clearTimeout(capTimer.current);
      capTimer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // BUG-0041: Bildschirm sperren war bisher ein sofortiger Abbruch. Ab jetzt bricht
  // erst das echte Signal — der Mikrofon-Track endet (oder der Browser kappt die
  // Erkennung dauerhaft). Sperren allein darf ein laufendes Diktat nicht vernichten.
  useEffect(() => {
    if (!recording) return;
    const notice = () => {
      if (document.visibilityState === "hidden") setInfo("Bildschirm gesperrt — Aufnahme läuft weiter, solange der Browser das Mikro hält.");
      else setInfo("");
    };
    const lost = () => {
      const rec = recorder.current;
      if (!rec) return;
      recorder.current = null;
      rec.cancel();
      setRecording(false);
      setPartial("");
      setError("Aufnahme abgebrochen — Mikrofon nicht mehr verfügbar.");
    };
    document.addEventListener("visibilitychange", notice);
    const track = recorder.current?.track();
    track?.addEventListener("ended", lost);
    return () => {
      document.removeEventListener("visibilitychange", notice);
      track?.removeEventListener("ended", lost);
    };
  }, [recording]);

  const applyText = async (text: string, meta?: string) => {
    const where = await pasteTranscript(text);
    if (where === "nowhere") setError("Kein Eingabefeld fokussiert — Text nicht eingefügt (Zwischenablage ebenfalls fehlgeschlagen).");
    else if (where === "clipboard-only") setInfo(`${meta ? `${meta} · ` : ""}nur Zwischenablage — kein fokussiertes Feld`);
    else setInfo(meta ?? "eingefügt");
  };

  const stopLocal = async () => {
    const rec = recorder.current;
    if (!rec) return;
    recorder.current = null;
    setRecording(false);
    setListening(true);
    try {
      const blob = await rec.stop();
      const t = await rec.transcribe(blob);
      if (t.text) await applyText(t.text, `lokal · ${t.engine} · ${(t.k6Ms / 1000).toFixed(1)} s${streamNotice ? " · Live-Vorschau nicht verfügbar" : ""}`);
      else setError("Nichts erkannt — nochmal versuchen.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Spracherkennung fehlgeschlagen.");
    } finally {
      setListening(false);
      setPartial("");
    }
  };

  const stop = () => {
    if (handle.current) handle.current.stop();
    else if (recorder.current) void stopLocal();
  };

  const startBrowser = () => {
    setError("");
    setInfo("");
    setPartial("");
    setRestarts(0);
  const lang = navigator.language || "de-DE";
    handle.current = startContinuousStt(lang, {
      onPreview: setPartial,
      onRestarts: setRestarts,
      onEnd: (info) => {
        handle.current = null;
        setListening(false);
        const took = secondsRef.current;
        if (info.reason === "fatal") {
          setPartial("");
          setError(info.message ?? "Spracherkennung fehlgeschlagen.");
          return;
        }
        if (!info.text) {
          setPartial("");
          setError(info.message ?? "Nichts gehört — bitte näher ans Mikrofon sprechen oder länger am Stück diktieren.");
          return;
        }
        setPartial("");
        void applyText(info.text, `Diktat · ${took} s${restarts ? ` · ${restarts}× neu gestartet` : ""}`);
      },
    });
    setListening(true);
  };

  // Esc wie Tippen: stoppen, der gehörte Text bleibt erhalten (Registry-Eintrag
  // „stt.cancel“ bleibt als ID bestehen, weil das Tastenkürzel im Übersichtsblatt
  // verlinkt ist — nur die Bedeutung hat sich von „verwerfen“ zu „stoppen“ geändert).
  useEffect(() => {
    if (!active) return;
    return registerShortcut("stt.cancel", (e) => {
      e.preventDefault();
      stop();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const toggle = async () => {
    if (localStt.available && recordingSupported()) {
      if (recording) return void stopLocal();
      setError("");
      setInfo("");
      setPartial("");
      setStreamNotice("");
      // BUG-0177: ohne streamendes ASR am Hub kann es keine Live-Wörter geben —
      // das muss sichtbar gesagt werden, sonst hält die Person die App für kaputt.
      if (!localStt.streaming) setStreamNotice("Live-Wörter brauchen ein streamendes ASR am Hub (stt.streaming) — der Text erscheint hier nach dem Stoppen.");
      try {
        const rec = new LocalRecorder();
        await rec.start(() => void stopLocal(), { onPartial: setPartial, onStreamError: setStreamNotice });
        recorder.current = rec;
        setRecording(true);
      } catch {
        setError("Mikrofon-Zugriff verweigert.");
      }
      return;
    }
    if (listening) {
      stop();
      return;
    }
    startBrowser();
  };

  const supported = speechRecognitionSupported() || (localStt.available && recordingSupported());
  const title = localStt.available
    ? `Spracheingabe lokal (${localStt.engine ?? "whisper"})`
    : speechRecognitionSupported()
      ? "Spracheingabe (Browser, meist Cloud)"
      : "Browser unterstützt keine Spracherkennung";

  return {
    toggle,
    stop,
    listening,
    recording,
    active,
    error,
    info,
    partial,
    streamNotice,
    seconds,
    restarts,
    supported,
    title,
    localAvailable: localStt.available,
  };
}
