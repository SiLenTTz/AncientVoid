import type { NormalizedEvent } from "../../shared/ws.ts";
import { visibleEventText } from "./event-text.ts";

/**
 * Ja/Nein-Rückfragen ohne Tippen: endet die letzte Assistant-Nachricht auf
 * eine Frage, stehen „Ja"/„Nein" als Buttons über dem Eingabefeld. Der Klick
 * sendet einen ganz normalen Prompt mit genau diesem festen Text — der
 * Agenten-Text steuert NUR die Sichtbarkeit der Buttons (PRD §8.5:
 * Agenten-Output ist Daten, nie Instruktion; hier entscheidet er über einen
 * festen „Ja"-Text, nicht darüber, was der Hub tut).
 */
export function lastAssistantQuestion(events: readonly NormalizedEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    if (event.type !== "assistant") continue;
    const text = visibleEventText(event).trimEnd();
    return text.endsWith("?") ? text : null;
  }
  return null;
}

export function QuickConfirm({ disabled, onAnswer }: { disabled: boolean; onAnswer: (text: string) => void }) {
  return (
    <div class="quick-confirm" role="group" aria-label="Ja/Nein antworten">
      <span class="dim">Agent fragt:</span>
      <button type="button" class="chip" disabled={disabled} onClick={() => onAnswer("Ja")}>
        Ja
      </button>
      <button type="button" class="chip" disabled={disabled} onClick={() => onAnswer("Nein")}>
        Nein
      </button>
    </div>
  );
}
