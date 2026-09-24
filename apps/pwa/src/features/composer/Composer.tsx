import { useEffect, useRef, useState } from "preact/hooks";
import { registerField, touchField, type FieldId } from "../../shared/command-context.ts";
import { useApi } from "../../shared/api-context.ts";
import type { ComponentChildren } from "preact";
import { recognizeOnce, speechRecognitionSupported } from "../../shared/speech.ts";
import { LocalRecorder, recordingSupported, sttStatus, transcribe } from "../../shared/local-stt.ts";
import { type PromptRecommendation } from "../../shared/api.ts";
import { saveSelectedSkill, saveSelectedWorkflow } from "./SkillOverlay.tsx";
import { AttachmentPicker } from "../attachments/Attachments.tsx";
import type { AttachmentRecord } from "../../shared/api.ts";

/** T1.5-8: enhance.ts only has a real implementation for these adapters —
 * never offer the button for an adapter it can't actually enhance for
 * (dummy has no LLM behind it at all). */
const ENHANCE_SUPPORTED_ADAPTERS = new Set(["claude", "codex", "opencode"]);

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
  extraActions,
  onUseRecommendation,
  attachments,
  onAttachmentsChange,
  fieldId,
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
  /** Session reply puts Senden and Stop in the same row as Voice and Verbessern. */
  extraActions?: ComponentChildren;
  /** New-session form applies a skill/agent through SessionSpec.args.
   * A reply has no such args, so the composer puts the name in the text. */
  onUseRecommendation?: (item: { kind: "skill" | "agent"; name: string }) => void;
  /** T7.10: files and images sent with this prompt. */
  attachments?: AttachmentRecord[];
  onAttachmentsChange?: (next: AttachmentRecord[]) => void;
  /** T9.4: the text entry may fill or rewrite this field. */
  fieldId?: FieldId;
}) {
  const api = useApi();
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => (fieldId ? registerField(fieldId, { get: () => valueRef.current, set: (t) => onChangeRef.current(t) }) : undefined), [fieldId]);
  const supported = speechRecognitionSupported();
  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState("");

  const enhanceSupported = ENHANCE_SUPPORTED_ADAPTERS.has(adapter);
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceError, setEnhanceError] = useState("");
  const [preview, setPreview] = useState<{ original: string; enhanced: string; costUsd?: number; latencyMs: number } | null>(
    null,
  );
  const [recommendation, setRecommendation] = useState<PromptRecommendation | null>(null);
  const [recommendError, setRecommendError] = useState("");
  const [recommendBusy, setRecommendBusy] = useState(false);

  // T10.2: local push-to-talk when the hub has a recogniser, else the browser's.
  const [localStt, setLocalStt] = useState<{ available: boolean; engine?: string }>({ available: false });
  useEffect(() => {
    void sttStatus().then(setLocalStt);
  }, []);
  const recorder = useRef<LocalRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [sttInfo, setSttInfo] = useState("");
  // AC-P10-5: a locked screen or a lost microphone ends the recording
  // visibly — nothing is transcribed or retried behind the person's back.
  useEffect(() => {
    if (!recording) return;
    const end = (why: string) => {
      recorder.current?.cancel();
      recorder.current = null;
      setRecording(false);
      setMicError(why);
    };
    const hidden = () => document.visibilityState === "hidden" && end("Aufnahme abgebrochen — Bildschirm gesperrt oder App verlassen.");
    const lost = () => end("Aufnahme abgebrochen — Mikrofon nicht mehr verfügbar.");
    document.addEventListener("visibilitychange", hidden);
    const track = recorder.current?.track();
    track?.addEventListener("ended", lost);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      track?.removeEventListener("ended", lost);
    };
  }, [recording]);

  const stopLocal = async () => {
    const rec = recorder.current;
    if (!rec) return;
    recorder.current = null;
    setRecording(false);
    setListening(true);
    try {
      const blob = await rec.stop();
      const t = await transcribe(blob, rec.stoppedAt);
      if (t.text) onChange(valueRef.current ? `${valueRef.current} ${t.text}` : t.text);
      else setMicError("Nichts erkannt — nochmal versuchen.");
      setSttInfo(`lokal · ${t.engine} · ${(t.k6Ms / 1000).toFixed(1)} s`);
    } catch (err) {
      setMicError(err instanceof Error ? err.message : "Spracherkennung fehlgeschlagen.");
    } finally {
      setListening(false);
    }
  };

  const toggleMic = async () => {
    if (localStt.available && recordingSupported()) {
      if (recording) return void stopLocal();
      setMicError("");
      setSttInfo("");
      try {
        const rec = new LocalRecorder();
        await rec.start(() => void stopLocal());
        recorder.current = rec;
        setRecording(true);
      } catch {
        setMicError("Mikrofon-Zugriff verweigert.");
      }
      return;
    }
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
    setRecommendError("");
    setEnhancing(true);
    try {
      // T1.5-8: only on explicit request, never automatic — this is the
      // one and only call site.
      const result = await api.enhancePrompt(adapter, project, value);
      setPreview({ original: value, enhanced: result.enhanced, costUsd: result.costUsd, latencyMs: result.latencyMs });
      setRecommendation(null);
      try {
        setRecommendation(await api.recommendPrompt(project, result.enhanced));
      } catch (err) {
        setRecommendError(err instanceof Error ? err.message : "Empfehlung fehlgeschlagen");
      }
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
    api
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
    setRecommendation(null);
  };

  const applyRecommendation = async (persist: boolean) => {
    if (!recommendation) return;
    setRecommendError("");
    setRecommendBusy(true);
    try {
      if (recommendation.mode === "create") {
        if (!recommendation.draft) throw new Error("Vorschlag hat keinen Entwurf");
        await api.saveArtifact({
          project,
          kind: recommendation.kind,
          name: recommendation.name,
          description: recommendation.description,
          draft: recommendation.draft,
        });
      }
      const base = preview?.enhanced ?? value;
      if (
        onUseRecommendation &&
        adapter === "claude" &&
        (recommendation.kind === "skill" || recommendation.kind === "agent")
      ) {
        onChange(base);
        onUseRecommendation({ kind: recommendation.kind, name: recommendation.name });
        if (persist) saveSelectedSkill(project, { kind: recommendation.kind, name: recommendation.name });
      } else {
        const line =
          recommendation.kind === "skill"
            ? `/${recommendation.name}\n\n`
            : recommendation.kind === "agent"
              ? `Agent: ${recommendation.name}\n\n`
              : `Workflow: ${recommendation.name}\n\n`;
        onChange(base.startsWith(line) ? base : `${line}${base}`);
        if (persist && (recommendation.kind === "skill" || recommendation.kind === "agent")) {
          saveSelectedSkill(project, { kind: recommendation.kind, name: recommendation.name });
        }
        if (persist && recommendation.kind === "workflow") saveSelectedWorkflow(project, recommendation.name);
      }
      if (preview) logFeedback("accepted");
      setPreview(null);
      setRecommendation(null);
    } catch (err) {
      setRecommendError(err instanceof Error ? err.message : "Empfehlung fehlgeschlagen");
    } finally {
      setRecommendBusy(false);
    }
  };

  const kindLabel = recommendation?.kind === "agent" ? "Agent" : recommendation?.kind === "workflow" ? "Workflow" : "Skill";
  const recommendNote =
    recommendation?.kind === "workflow"
      ? "Workflows haben keinen Adapter-Aufruf. Der Name kommt in den Prompt."
      : adapter !== "claude"
        ? "Dieser Adapter übernimmt den Eintrag nicht direkt. Der Name kommt in den Prompt."
        : recommendation?.mode === "create"
          ? "Nutzen legt die Datei an und nimmt sie für diesen Prompt. Speichern merkt sie als Standard."
          : "Nutzen gilt für diesen Prompt. Speichern merkt sie als Standard für das Projekt.";

  return (
    <div class="composer">
      <textarea
        class="composer-input"
        value={value}
        onInput={(e) => onChange((e.target as HTMLTextAreaElement).value)}
        placeholder={placeholder}
        disabled={disabled}
        rows={2}
        onFocus={() => fieldId && touchField(fieldId)}
      />
      {recording && <div class="composer-notice dim">🔴 Aufnahme — tippe „Stopp“, wenn du fertig bist (bleibt auf deinen Rechnern)</div>}
      {sttInfo && !micError && <div class="composer-notice dim">{sttInfo}</div>}
      {listening && !localStt.available && (
        <div class="composer-notice dim">
          🔴 höre zu… (Spracherkennung läuft meist über einen Cloud-Dienst des Browsers)
        </div>
      )}
      {micError && <div class="composer-notice err">{micError}</div>}
      {enhanceError && <div class="composer-notice err">{enhanceError}</div>}
      {recommendError && !recommendation && <div class="composer-notice err">{recommendError}</div>}

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

      {recommendation && (
        <div class="recommend-card">
          <div class="dim" style="font-size: 11px">
            {recommendation.mode === "match" ? `Empfehlung · ${kindLabel}` : `Vorschlag · ${kindLabel} anlegen`}
          </div>
          <strong>{recommendation.name}</strong>
          <div class="dim" style="font-size: 12px">{recommendation.description}</div>
          <div class="dim" style="font-size: 11px">{recommendation.reason}</div>
          <div class="dim" style="font-size: 11px">{recommendNote}</div>
          {recommendError && <div class="composer-notice err">{recommendError}</div>}
          <div class="row">
            <button class="btn" type="button" disabled={recommendBusy} onClick={() => setRecommendation(null)}>
              Verwerfen
            </button>
            <button
              class={recommendBusy ? "btn busy" : "btn"}
              type="button"
              aria-busy={recommendBusy}
              disabled={recommendBusy}
              onClick={() => void applyRecommendation(false)}
            >
              {recommendBusy ? "lädt…" : "Nutzen"}
            </button>
            <button
              class={recommendBusy ? "btn primary busy" : "btn primary"}
              type="button"
              aria-busy={recommendBusy}
              disabled={recommendBusy}
              onClick={() => void applyRecommendation(true)}
            >
              {recommendBusy ? "lädt…" : "Speichern"}
            </button>
          </div>
        </div>
      )}

      {/* T8.5: the paperclip sits in the button row; chips get their own
       * row above it (CSS order) — one row less than before. */}
      <div class="composer-actions">
        {attachments && onAttachmentsChange && (
          <span class="composer-attachments">
            <AttachmentPicker attachments={attachments} onChange={onAttachmentsChange} {...(disabled !== undefined ? { disabled } : {})} />
          </span>
        )}
        <button
          class={listening ? "btn busy" : "btn"}
          type="button"
          aria-busy={listening}
          onClick={toggleMic}
          disabled={disabled || (!supported && !(localStt.available && recordingSupported())) || listening}
          title={localStt.available ? `Spracheingabe lokal (${localStt.engine ?? "whisper"})` : supported ? "Spracheingabe (Browser, meist Cloud)" : "Browser unterstützt keine Spracherkennung"}
        >
          {listening ? "lädt…" : recording ? "Stopp" : "Voice"}
        </button>
        <button
          class={enhancing ? "btn busy" : "btn"}
          type="button"
          aria-busy={enhancing}
          onClick={enhance}
          disabled={disabled || !enhanceSupported || enhancing || !value.trim()}
          title={enhanceSupported ? "Prompt verbessern (kostet echtes Kontingent)" : "Für diesen Adapter nicht verfügbar"}
        >
          {enhancing ? "lädt…" : "Verbessern"}
        </button>
        {extraActions}
      </div>
    </div>
  );
}
