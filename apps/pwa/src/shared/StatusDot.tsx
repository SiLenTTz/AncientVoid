import { displayLabel, displayState, type DisplayInput } from "./display-state.ts";

/**
 * EPIC-P43 T43.2: der eine Baustein für Session-Zustand — Farbe, Form und Bewegung zusammen
 * (Design-Review §4.1), damit der Zustand auch ohne Farbe lesbar ist. Ersetzt Pillen und Punkte in
 * Karte, Kopf, Kachel und Statuszeile. `data-status` trägt weiter den rohen Hub-Status.
 *
 * `label`: das Wort steht daneben. Ohne Wort bleibt es für Screenreader erhalten.
 */
export function StatusDot({ label = true, class: cls, ...input }: DisplayInput & { label?: boolean; class?: string }) {
  const state = displayState(input);
  const text = displayLabel(input);
  // Schlüssel = Zustand: wechselt er, entsteht das Zeichen neu und die einmalige Bewegung (Ruf, Einrasten) läuft.
  return (
    <span class={`status status-${state}${cls ? ` ${cls}` : ""}`} data-status={input.status} data-display={state} title={label ? undefined : text}>
      <span key={state} class={`status-mark${MOTION[state] ? ` ${MOTION[state]}` : ""}`} aria-hidden="true" />
      <span class={label ? "status-label" : "status-label sr-only"}>{text}</span>
    </span>
  );
}

const MOTION: Record<string, string> = {
  working: "mv-breathe",
  approval: "mv-call",
  question: "mv-call",
  done: "mv-snap",
  error: "mv-shake",
};
