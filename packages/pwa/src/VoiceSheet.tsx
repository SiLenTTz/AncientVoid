import { useEffect, useState } from "preact/hooks";
import { recognizeOnce, speechRecognitionSupported, type SpeechResult } from "./speech.ts";

/**
 * T1.6-7 — global voice-command entry point (Voice dock item). Reuses
 * T1.5-7's recognizeOnce() as-is (same Web Speech API call, same 10s
 * timeout for a browser that never fires a callback — see speech.ts's own
 * doc comment for why that guard exists).
 *
 * Deliberately transcription-only: this sheet shows what was heard and
 * stops there. Turning a transcript into an actual action (navigate to a
 * project, start a session, read back the quota) is EPIC-P3's T3.10
 * (Sprach-Direktiven-Parser) — building a fake "executed!" toast here
 * would suggest a capability that doesn't exist yet (Premortem 5).
 */
const EXAMPLE_COMMANDS = ["Zeig mir mobile-hub", "Neue Session mit Codex starten", "Wie ist mein Kontingent?"];

export function VoiceSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [state, setState] = useState<"idle" | "listening" | "done">("idle");
  const [result, setResult] = useState<SpeechResult | null>(null);
  const [pickedExample, setPickedExample] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setState("listening");
    setResult(null);
    setPickedExample(null);
    let alive = true;
    recognizeOnce().then((r) => {
      if (!alive) return;
      setResult(r);
      setState("done");
    });
    return () => {
      alive = false;
    };
  }, [open]);

  if (!open) return null;

  const supported = speechRecognitionSupported();

  return (
    <div class="overlay-backdrop" onClick={onClose}>
      <div class="overlay-sheet" onClick={(e) => e.stopPropagation()}>
        <div class="row" style="justify-content: space-between; align-items: center">
          <strong>Sprachbefehl</strong>
          <button class="btn" onClick={onClose}>
            ✕
          </button>
        </div>
        {!supported ? (
          <p class="dim" style="margin-top: 12px">
            Dieser Browser unterstützt keine Spracherkennung (Web Speech API fehlt).
          </p>
        ) : (
          <>
            <div class="voice-orb-wrap">
              <div class={`voice-orb ${state === "listening" ? "listening" : ""}`} />
            </div>
            <p class="voice-state">
              {state === "listening" ? "Ich höre zu …" : result?.ok ? "Erkannt" : "Nicht erkannt"}
            </p>
            {result &&
              (result.ok ? (
                <p class="voice-example">„{result.text}"</p>
              ) : (
                <p class="voice-example">
                  {result.reason === "timeout"
                    ? "Zeitüberschreitung — kein Ergebnis vom Browser."
                    : result.reason === "not-allowed"
                      ? "Mikrofon-Zugriff verweigert."
                      : result.reason === "no-speech"
                        ? "Nichts gehört."
                        : "Erkennung fehlgeschlagen."}
                </p>
              ))}
            <span class="preview-tag">Vorschau — Ausführung folgt (P3)</span>
          </>
        )}
        <div class="label" style="margin: 14px 0 6px">
          Beispiel-Befehle
        </div>
        {EXAMPLE_COMMANDS.map((cmd) => (
          <button
            key={cmd}
            type="button"
            class="chip subtle voice-example-chip"
            onClick={() => setPickedExample(cmd)}
          >
            „{cmd}"
          </button>
        ))}
        {pickedExample && (
          <p class="dim" style="margin-top: 8px">
            Noch keine Ausführung — nur eine Vorschau, welche Befehle künftig erkannt werden sollen.
          </p>
        )}
      </div>
    </div>
  );
}
