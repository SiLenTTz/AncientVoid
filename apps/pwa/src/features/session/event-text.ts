import type { NormalizedEvent } from "../../shared/ws.ts";

/**
 * Chat rows were rendering `summary`, which the adapter caps at 200
 * characters on one line. The full assistant text stays on `payload.text`
 * (the Claude URL close-out of 2026-09-22 was 1611 characters, summary 200).
 */
export function visibleEventText(event: NormalizedEvent): string {
  if (event.type === "assistant" || event.type === "user") {
    const text = event.payload.text;
    if (typeof text === "string" && text.length > 0) return text;
  }
  // BUG-0033: a refused prompt looked delivered in the chat — the why
  // (e.g. "der Zug läuft noch") travels on the session.steer event.
  if (event.type === "system" && event.payload.kind === "session.steer" && event.payload.ok === false) {
    const detail = event.payload.detail;
    return typeof detail === "string" && detail.length > 0 ? `Nicht zugestellt: ${detail}` : "Nicht zugestellt";
  }
  return event.summary;
}
