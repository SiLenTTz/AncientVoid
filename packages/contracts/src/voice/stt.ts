/** Maximum lifetime of the single-use ticket used to open one STT socket. */
export const STT_STREAM_TICKET_TTL_MS = 15_000;

/** Raw 16 kHz mono PCM16 audio allowed per push-to-talk utterance. */
export const STT_STREAM_MAX_AUDIO_BYTES = 16_000 * 2 * 60;

/** Bound queued audio so a slow Hub or model cannot grow browser memory. */
export const STT_STREAM_MAX_BUFFERED_BYTES = 64 * 1024;
/** Keep every one-shot WS event comfortably below the EventStore K5 limit. */
export const STT_STREAM_MAX_EVENT_BYTES = 4 * 1024;
/** Bound accumulated provider text for a single dictated utterance. */
export const STT_STREAM_MAX_TEXT_BYTES = 16 * 1024;
export const STT_STREAM_MAX_PENDING_TICKETS = 256;
export const STT_STREAM_MAX_ACTIVE = 8;

export interface SttStreamTicket {
  ticket: string;
  expiresAt: number;
}

/** Text deltas are preview-only. Only `final` may be inserted in the field. */
export type SttStreamEvent =
  | { type: "ready" }
  | { type: "partial"; text: string }
  | { type: "final"; text: string; engine: string }
  | { type: "error"; message: string };
