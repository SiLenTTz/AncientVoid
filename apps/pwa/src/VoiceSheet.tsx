import { useEffect, useRef, useState } from "preact/hooks";
import { useApi } from "./api-context.ts";
import { recognizeOnce, speechRecognitionSupported, type SpeechResult } from "./speech.ts";
import { parseVoiceDirective, type VoiceDirective } from "./voice-directives.ts";

/**
 * T1.6-7 → T3.10 — global voice-command entry point (Voice dock item).
 * Reuses T1.5-7's recognizeOnce() as-is (same Web Speech API call, same
 * 10s timeout for a browser that never fires a callback — see speech.ts's
 * own doc comment for why that guard exists).
 *
 * T1.6-7 was deliberately transcription-only ("building a fake 'executed!'
 * toast here would suggest a capability that doesn't exist yet"). T3.10
 * (voice-directives.ts) is that missing execution half, but only for the
 * two directives EPIC-P3 §4 names by example (stop, budget change) — and
 * AC-P3-7 requires a real write-Gate confirm step, never silent execution:
 * a directive is parsed, shown back with its summary, and only actually
 * sent to the hub after an explicit tap.
 *
 * BUG (found live, 2026-09-19, real device): recognition used to
 * auto-start in a `useEffect` reacting to `open` — one render tick after
 * the dock's own tap already returned control to the browser's event
 * loop. Mobile browsers (documented WebKit/Blink behavior — mic/speech
 * APIs require `.start()` to run inside the SAME synchronous call stack
 * as the triggering user gesture) then silently refuse to even show the
 * permission prompt: no error, no prompt, nothing — exactly "nix passiert
 * einfach". Fixed by requiring an explicit "Tippen zum Sprechen" tap
 * *inside the open sheet*, whose onClick calls recognizeOnce() directly —
 * that tap is its own fresh, synchronous user gesture. Not verified on an
 * actual phone from here (no device access) — needs a real retest.
 */
const EXAMPLE_COMMANDS = ["Zeig mir mobile-hub", "Neue Session mit Codex starten", "Wie ist mein Kontingent?"];

export function VoiceSheet({
  open,
  onClose,
  sessionId,
}: {
  open: boolean;
  onClose: () => void;
  /** T3.10: only a directive scoped to one session (stop/budget) can be
   * confirmed and executed — undefined (opened from the Dashboard, not a
   * session) is a real, honestly-shown limitation, not a silent no-op. */
  sessionId?: string;
}) {
  const api = useApi();
  const [state, setState] = useState<"idle" | "listening" | "done">("idle");
  const [result, setResult] = useState<SpeechResult | null>(null);
  const [pickedExample, setPickedExample] = useState<string | null>(null);
  const [directive, setDirective] = useState<VoiceDirective | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionResult, setActionResult] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (!open) return;
    // Reset to the idle "tap to speak" state on every open — never
    // auto-starts recognition (see this file's own doc comment for why).
    setState("idle");
    setResult(null);
    setPickedExample(null);
    setDirective(null);
    setActionResult(null);
    return () => {
      alive.current = false;
    };
  }, [open]);

  // Called directly from a button's onClick — must stay synchronous up to
  // the recognizeOnce() call itself for the real reason in this file's
  // top doc comment. Do not move this into a useEffect.
  const startListening = () => {
    setState("listening");
    setResult(null);
    setDirective(null);
    setActionResult(null);
    recognizeOnce().then((r) => {
      if (!alive.current) return;
      setResult(r);
      setState("done");
      if (r.ok) {
        const parsed = parseVoiceDirective(r.text);
        if (parsed.kind !== "unrecognized") setDirective(parsed);
      }
    });
  };

  if (!open) return null;

  const supported = speechRecognitionSupported();

  const confirmDirective = async () => {
    if (!directive || directive.kind === "unrecognized" || !sessionId) return;
    setBusy(true);
    try {
      if (directive.kind === "stop") {
        await api.stopSession(sessionId);
        setActionResult("Session gestoppt.");
      } else if (directive.kind === "budget") {
        const ack = await api.requestBudgetTopUp(sessionId, directive.amountUsd);
        setActionResult(
          ack.ok ? "Budget geändert." : `Zur Freigabe eingereicht (${ack.detail ?? "wartet auf Bestätigung"}).`,
        );
      }
    } catch (err) {
      setActionResult(err instanceof Error ? err.message : "Aktion fehlgeschlagen");
    } finally {
      setBusy(false);
      setDirective(null);
    }
  };

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
              <button
                type="button"
                class={`voice-orb ${state === "listening" ? "listening" : ""}`}
                onClick={state === "listening" ? undefined : startListening}
                disabled={state === "listening"}
                title={state === "idle" ? "Tippen zum Sprechen" : "Nochmal"}
              />
            </div>
            <p class="voice-state">
              {state === "idle"
                ? "Tippen zum Sprechen"
                : state === "listening"
                  ? "Ich höre zu …"
                  : result?.ok
                    ? "Erkannt"
                    : "Nicht erkannt"}
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

            {directive && directive.kind !== "unrecognized" && !actionResult && (
              <div class="card" style="margin-top: 10px; display: grid; gap: 8px">
                <div>{directive.summary}?</div>
                {!sessionId ? (
                  <div class="dim" style="font-size: 12px">
                    Keine Session ausgewählt — aus einer laufenden Session heraus sprechen, um dies auszuführen.
                  </div>
                ) : (
                  <div class="row" style="gap: 8px">
                    <button class={busy ? "btn primary busy" : "btn primary"} aria-busy={busy} onClick={confirmDirective} disabled={busy}>
                      {busy ? "lädt…" : "Bestätigen"}
                    </button>
                    <button class="btn" onClick={() => setDirective(null)} disabled={busy}>
                      Abbrechen
                    </button>
                  </div>
                )}
              </div>
            )}
            {actionResult && <p class="voice-example">{actionResult}</p>}
            {!directive && !actionResult && <span class="preview-tag">Vorschau — nur „stopp"/„Budget …" werden ausgeführt (T3.10)</span>}
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
