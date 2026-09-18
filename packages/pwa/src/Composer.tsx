import { useState } from "preact/hooks";
import { recognizeOnce, speechRecognitionSupported } from "./speech.ts";
import { hubApi } from "./api.ts";

/** T1.5-8: enhance.ts only has a real implementation for these two —
 * never offer the button for an adapter it can't actually enhance for
 * (dummy has no LLM behind it at all). */
const ENHANCE_SUPPORTED_ADAPTERS = new Set(["claude", "codex"]);

/**
 * T1.5-6 — the shared prompt-entry surface, used both when creating a
 * session (App.tsx) and as a follow-up reply in a running one
 * (SessionTail.tsx). Only the text field + its action row (mic, enhance)
 * live here; each caller supplies its own submit trigger, since "Starten"
 * (bundled with adapter+project) and "Senden" (text alone) are different
 * actions that happen to share the same input surface.
 */
export function Composer({
  value,
  onChange,
  placeholder,
  disabled,
  adapter,
  project,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Which adapter's own subscription pays for an enhance call (§3.4
   * decision: reuse the already-logged-in adapter, not a separate model
   * — see enhance.ts for the real measurements behind that choice). */
  adapter: string;
  /** The enhance call's cwd — found necessary via a real test: without
   * it, the rewrite reflected the hub server's own repo, not whatever
   * project the user actually selected. */
  project: string;
}) {
  const supported = speechRecognitionSupported();
  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState("");

  const enhanceSupported = ENHANCE_SUPPORTED_ADAPTERS.has(adapter);
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceError, setEnhanceError] = useState("");
  const [preview, setPreview] = useState<{ original: string; enhanced: string; costUsd?: number; latencyMs: number } | null>(
    null,
  );

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

  const enhance = async () => {
    if (!value.trim()) return;
    setEnhanceError("");
    setEnhancing(true);
    try {
      // T1.5-8: only on explicit request, never automatic — this is the
      // one and only call site.
      const result = await hubApi.enhancePrompt(adapter, project, value);
      setPreview({ original: value, enhanced: result.enhanced, costUsd: result.costUsd, latencyMs: result.latencyMs });
    } catch (err) {
      setEnhanceError(err instanceof Error ? err.message : "Verbessern fehlgeschlagen");
    } finally {
      setEnhancing(false);
    }
  };

  // T3.9: best-effort, never blocks the actual accept/reject action on
  // network success — a failed feedback write is a missed data point for
  // a future optimizer revision, not a reason to disrupt the user's flow.
  const logFeedback = (decision: "accepted" | "rejected") => {
    if (!preview) return;
    hubApi
      .recordOptimizerFeedback({
        adapter,
        project,
        original: preview.original,
        enhanced: preview.enhanced,
        decision,
        ...(preview.costUsd !== undefined ? { costUsd: preview.costUsd } : {}),
        latencyMs: preview.latencyMs,
      })
      .catch(() => undefined);
  };

  const acceptEnhanced = () => {
    logFeedback("accepted");
    if (preview) onChange(preview.enhanced);
    setPreview(null);
  };

  const keepOriginal = () => {
    logFeedback("rejected");
    setPreview(null);
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
      {enhanceError && <div class="composer-notice err">{enhanceError}</div>}

      {preview && (
        <div class="enhance-preview">
          <div class="enhance-preview-col">
            <div class="dim" style="font-size: 11px">Original</div>
            <div class="enhance-preview-text">{preview.original}</div>
          </div>
          <div class="enhance-preview-col">
            <div class="dim" style="font-size: 11px">
              Verbessert
              {preview.costUsd !== undefined ? ` · $${preview.costUsd.toFixed(4)}` : ""} ·{" "}
              {(preview.latencyMs / 1000).toFixed(1)}s
            </div>
            <div class="enhance-preview-text">{preview.enhanced}</div>
          </div>
          <div class="row" style="gap: 8px">
            <button class="btn" type="button" onClick={keepOriginal}>
              Original senden
            </button>
            <button class="btn primary" type="button" onClick={acceptEnhanced}>
              Verbessertes übernehmen
            </button>
          </div>
        </div>
      )}

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
        <button
          class="btn"
          type="button"
          onClick={enhance}
          disabled={disabled || !enhanceSupported || enhancing || !value.trim()}
          title={enhanceSupported ? "Prompt verbessern (kostet echtes Kontingent)" : "Für diesen Adapter nicht verfügbar"}
        >
          {enhancing ? "✨ …" : "✨ Verbessern"}
        </button>
      </div>
    </div>
  );
}
