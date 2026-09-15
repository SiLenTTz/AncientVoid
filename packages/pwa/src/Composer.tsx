import { useState } from "preact/hooks";
import { recognizeOnce, speechRecognitionSupported } from "./speech.ts";

/**
 * T1.5-6 — the shared prompt-entry surface, used both when creating a
 * session (App.tsx) and as a follow-up reply in a running one
 * (SessionTail.tsx). Only the text field + its action row (mic, enhance)
 * live here; each caller supplies its own submit trigger, since "Starten"
 * (bundled with adapter+project) and "Senden" (text alone) are different
 * actions that happen to share the same input surface.
 *
 * The "Verbessern" button is a deliberate, visible placeholder — T1.5-8
 * wires it up. Disabled + labeled, never a silent dead button.
 */
export function Composer({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const supported = speechRecognitionSupported();
  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState("");

  const toggleMic = async () => {
    if (listening) return; // recognizeOnce already runs to completion/timeout
    setMicError("");
    setListening(true);
    const result = await recognizeOnce();
    setListening(false);
    if (result.ok) {
      // Never auto-submit — the transcript lands in the editable field,
      // appended to whatever's already there, exactly like typing (§3.3).
      onChange(value ? `${value} ${result.text}` : result.text);
    } else if (result.reason === "no-speech") {
      setMicError("Nichts gehört — nochmal versuchen.");
    } else if (result.reason === "not-allowed") {
      setMicError("Mikrofon-Zugriff verweigert.");
    } else if (result.reason === "timeout") {
      setMicError("Spracherkennung hat nicht geantwortet.");
    } else {
      setMicError("Spracherkennung fehlgeschlagen.");
    }
  };

  return (
    <div class="composer">
      <textarea
        class="composer-input"
        value={value}
        onInput={(e) => onChange((e.target as HTMLTextAreaElement).value)}
        placeholder={placeholder}
        disabled={disabled}
        rows={2}
      />
      {listening && (
        <div class="composer-notice dim">
          🔴 höre zu… (Spracherkennung läuft meist über einen Cloud-Dienst des Browsers)
        </div>
      )}
      {micError && <div class="composer-notice err">{micError}</div>}
      <div class="composer-actions">
        <button
          class="btn"
          type="button"
          onClick={toggleMic}
          disabled={disabled || !supported || listening}
          title={supported ? "Spracheingabe" : "Browser unterstützt keine Spracherkennung"}
        >
          {listening ? "🔴" : "🎤"}
        </button>
        <button class="btn" type="button" disabled title="Prompt-Enhancer (T1.5-8, noch nicht verfügbar)">
          ✨ Verbessern
        </button>
      </div>
    </div>
  );
}
