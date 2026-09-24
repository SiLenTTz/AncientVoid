import { useEffect, useRef, useState } from "preact/hooks";
import { hubApi, type CommandPlan } from "../../shared/api.ts";
import { recognizeOnce, speechRecognitionSupported, type SpeechResult } from "../../shared/speech.ts";
import { commandContext, field, type FieldId } from "../../shared/command-context.ts";
import { runClientStep } from "../commands/CommandBar.tsx";

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
/** AI-P9-3 / T10.3: spoken words go through the same planner as typed
 * ones (ADR-0027) — navigation runs at once, anything that changes
 * something waits for "Bestätigen"; "nicht stoppen" and questions do nothing. */
const EXAMPLE_COMMANDS = ["Zeig wartende Sessions", "Stopp", "Budget auf 5 Dollar"];

export function VoiceSheet({
  open,
  onClose,
  sessionId,
}: {
  open: boolean;
  onClose: () => void;
  /** Kept for callers; the planner reads the open session from the context. */
  sessionId?: string;
}) {
  const [state, setState] = useState<"idle" | "listening" | "done">("idle");
  const [result, setResult] = useState<SpeechResult | null>(null);
  const [plan, setPlan] = useState<CommandPlan | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [actionResult, setActionResult] = useState<string | null>(null);
  const alive = useRef(true);
  void sessionId;

  useEffect(() => {
    alive.current = true;
    if (!open) return;
    // Reset to the idle "tap to speak" state on every open — never
    // auto-starts recognition (see this file's own doc comment for why).
    setState("idle");
    setResult(null);
    setPlan(null);
    setAnswers({});
    setActionResult(null);
    setUndo(null);
    return () => {
      alive.current = false;
    };
  }, [open]);

  const [undo, setUndo] = useState<{ field: FieldId; before: string } | null>(null);
  const run = async (p: CommandPlan) => {
    setBusy(true);
    try {
      const first = p.steps[0];
      // Field steps happen here, in the app: fill or rewrite, never send.
      if (first && (first.op === "field.fill" || first.op === "field.transform")) {
        const id = String(first.args.field) as FieldId;
        const f = field(id);
        if (!f) throw new Error("Das Feld ist hier nicht offen.");
        const before = f.get();
        const after = first.op === "field.fill" ? String(first.args.text) : (await hubApi.commandTransform(before, String(first.args.transform))).text;
        f.set(after);
        setUndo({ field: id, before });
        setActionResult(first.op === "field.fill" ? "eingetragen — nicht gesendet" : "Text bearbeitet — nicht gesendet");
        return;
      }
      const res = await hubApi.commandExecute(p.id, commandContext());
      const lines = res.results.map((r) => (r.client ? runClientStep(r.client) || r.detail : r.detail));
      setActionResult(lines.join(" · ") || "erledigt");
      if (res.results.every((r) => r.ok) && p.steps.every((s) => s.risk === "read")) onClose();
    } catch (err) {
      setActionResult(err instanceof Error ? err.message : "Aktion fehlgeschlagen");
    } finally {
      setBusy(false);
      setPlan(null);
    }
  };

  const understand = async (text: string, withAnswers: Record<string, string> = {}) => {
    setBusy(true);
    setActionResult(null);
    try {
      const p = await hubApi.commandPlan(text, commandContext(), Object.keys(withAnswers).length ? withAnswers : undefined);
      if (!alive.current) return;
      setPlan(p);
      if (!p.question && !p.refusal && p.steps.length > 0 && p.steps.every((s) => s.risk === "read" && !s.op.startsWith("field."))) await run(p);
    } catch (err) {
      setActionResult(err instanceof Error ? err.message : "Nicht verstanden");
    } finally {
      setBusy(false);
    }
  };

  // Called directly from a button's onClick — must stay synchronous up to
  // the recognizeOnce() call itself for the real reason in this file's
  // top doc comment. Do not move this into a useEffect.
  const startListening = () => {
    setState("listening");
    setResult(null);
    setPlan(null);
    setActionResult(null);
    recognizeOnce().then((r) => {
      if (!alive.current) return;
      setResult(r);
      setState("done");
      if (r.ok) void understand(r.text);
    });
  };

  if (!open) return null;

  const supported = speechRecognitionSupported();
  const pickExample = (cmd: string) => {
    setResult({ ok: true, text: cmd } as SpeechResult);
    setState("done");
    setAnswers({});
    void understand(cmd);
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
          </>
        )}
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
        {plan?.refusal && <p class="voice-example command-refusal">{plan.refusal}</p>}
        {plan && !plan.refusal && !plan.question && plan.steps.length === 0 && <p class="voice-example dim">Kein Auftrag erkannt — es passiert nichts.</p>}
        {plan?.question && (
          <div class="card" style="margin-top: 10px; display: grid; gap: 8px">
            <div>{plan.question.question}</div>
            <div class="command-options">
              {plan.question.options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  class="chip"
                  onClick={() => {
                    const next = { ...answers, [plan.question!.param]: o.value };
                    setAnswers(next);
                    void understand(plan.text, next);
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {plan && plan.steps.length > 0 && plan.steps.some((s) => s.risk !== "read" || s.op.startsWith("field.")) && !actionResult && (
          <div class="card" style="margin-top: 10px; display: grid; gap: 8px">
            {plan.steps.map((s, i) => (
              <div key={i}>{s.summary}?</div>
            ))}
            <div class="row" style="gap: 8px">
              <button class={busy ? "btn primary busy" : "btn primary"} aria-busy={busy} onClick={() => void run(plan)} disabled={busy}>
                {busy ? "lädt…" : "Bestätigen"}
              </button>
              <button class="btn" onClick={() => setPlan(null)} disabled={busy}>
                Abbrechen
              </button>
            </div>
          </div>
        )}
        {actionResult && <p class="voice-example">{actionResult}</p>}
        {undo && (
          <button
            type="button"
            class="btn"
            onClick={() => {
              field(undo.field)?.set(undo.before);
              setUndo(null);
              setActionResult("rückgängig gemacht");
            }}
          >
            Rückgängig
          </button>
        )}
        <div class="label" style="margin: 14px 0 6px">
          Beispiele
        </div>
        {EXAMPLE_COMMANDS.map((cmd) => (
          <button key={cmd} type="button" class="chip subtle voice-example-chip" onClick={() => pickExample(cmd)}>
            „{cmd}"
          </button>
        ))}
        <p class="dim" style="margin: 6px 0 0; font-size: 12px">
          Alles, was die Texteingabe (✦) versteht, geht auch gesprochen. Freigaben und Schlüssel bleiben ein Tippen.
        </p>
      </div>
    </div>
  );
}
