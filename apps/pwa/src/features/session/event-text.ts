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

/** BUG-0068: the EventStore moved this payload to a blob (K5) and left
 * `{truncated, bytes, preview}` behind. An adapter's own blobRef (raw
 * output next to a real payload) is not that. */
export function isOffloaded(event: NormalizedEvent): boolean {
  return event.blobRef !== null && event.payload.truncated === true;
}

/** The event with its real payload from the blob — unchanged when the blob
 * is not a payload object, so a bad blob never blanks the row. */
export function withBlobPayload(event: NormalizedEvent, raw: string): NormalizedEvent {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return event;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return event;
  return { ...event, payload: payload as Record<string, unknown> };
}
