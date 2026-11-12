import { useEffect, useRef, useState } from "preact/hooks";
import { recognizeOnce, speechRecognitionSupported } from "../../shared/speech.ts";
import { LocalRecorder, recordingSupported, sttStatus } from "../../shared/local-stt.ts";
import { pasteTranscript } from "./paste-target.ts";

/**
 * Dieselbe Push-to-Talk-Logik wie früher im Composer-Mikrofon:
 * lokal (Hub/whisper) wenn verfügbar, sonst Web Speech API.
 */
export function usePushToTalk() {
  const [localStt, setLocalStt] = useState<{ available: boolean; engine?: string; streaming?: boolean }>({ available: false });
  const [listening, setListening] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [partial, setPartial] = useState("");
  const [streamNotice, setStreamNotice] = useState("");
  const recorder = useRef<LocalRecorder | null>(null);

  useEffect(() => {
    void sttStatus().then(setLocalStt);
  }, []);

  useEffect(() => {
    if (!recording) return;
    const end = (why: string) => {
      recorder.current?.cancel();
      recorder.current = null;
      setRecording(false);
      setPartial("");
      setError(why);
    };
    const hidden = () => document.visibilityState === "hidden" && end("Aufnahme abgebrochen — Bildschirm gesperrt oder App verlassen.");
    const lost = () => end("Aufnahme abgebrochen — Mikrofon nicht mehr verfügbar.");
    document.addEventListener("visibilitychange", hidden);
    const track = recorder.current?.track();
    track?.addEventListener("ended", lost);
    hidden();
    return () => {
      document.removeEventListener("visibilitychange", hidden);
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

  const toggle = async () => {
    if (localStt.available && recordingSupported()) {
      if (recording) return void stopLocal();
      setError("");
      setInfo("");
      setPartial("");
      setStreamNotice("");
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
    if (listening) return;
    setError("");
    setInfo("");
    setListening(true);
    const result = await recognizeOnce();
    setListening(false);
    if (result.ok) await applyText(result.text, "Browser-Spracherkennung");
    else if (result.reason === "no-speech") setError("Nichts gehört — nochmal versuchen.");
    else if (result.reason === "not-allowed") setError("Mikrofon-Zugriff verweigert.");
    else if (result.reason === "timeout") setError("Spracherkennung hat nicht geantwortet.");
    else setError("Spracherkennung fehlgeschlagen.");
  };

  const supported = speechRecognitionSupported() || (localStt.available && recordingSupported());
  const title = localStt.available
    ? `Spracheingabe lokal (${localStt.engine ?? "whisper"})`
    : speechRecognitionSupported()
      ? "Spracheingabe (Browser, meist Cloud)"
      : "Browser unterstützt keine Spracherkennung";

  return {
    toggle,
    listening,
    recording,
    error,
    info,
    partial,
    streamNotice,
    supported,
    title,
    localAvailable: localStt.available,
  };
}
