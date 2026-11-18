/** Maximum lifetime of the single-use ticket used to open one STT socket. */
export const STT_STREAM_TICKET_TTL_MS = 15_000;

/** How long one dictated utterance may run — stated in seconds, because that is the
 *  number a person feels. A one-to-two minute instruction is normal dictation, so one
 *  minute was too tight (BUG-0215). At 16 kHz mono PCM16, 180 s is 5.76 MB per session. */
export const STT_STREAM_MAX_AUDIO_SECONDS = 180;
/** Raw 16 kHz mono PCM16 audio allowed per push-to-talk utterance. */
export const STT_STREAM_MAX_AUDIO_BYTES = 16_000 * 2 * STT_STREAM_MAX_AUDIO_SECONDS;

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
