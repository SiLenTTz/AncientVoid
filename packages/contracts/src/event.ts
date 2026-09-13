import { z } from "zod";

/**
 * K5 — Standard-Adapter-Event-Größe ≤ 4 KB unchunked.
 * Events whose serialized payload exceeds this limit must be offloaded to a
 * blob by the EventStore; the JSONL line keeps only an anchor + blob_ref.
 */
export const MAX_EVENT_PAYLOAD_BYTES = 4096;

/** Maximum length of the human-readable event summary (P0 data model). */
export const MAX_SUMMARY_CHARS = 200;

export const EVENT_TYPES = [
  "user",
  "assistant",
  "thinking",
  "tool_use",
  "tool_result",
  "gate",
  "error",
  "system",
] as const;

export const EventType = z.enum(EVENT_TYPES);
export type EventType = (typeof EVENT_TYPES)[number];

/**
 * The canonical, provider-neutral event. One JSONL line per event.
 * Payload must stay small (K5); large outputs are referenced via blobRef.
 */
export const NormalizedEvent = z.object({
  /** Monotonic per-session sequence number assigned by the hub. */
  seq: z.number().int().nonnegative(),
  /** ISO-8601 timestamp (assigned by the hub unless adapter provides one). */
  ts: z.string().min(1),
  sessionId: z.string().min(1),
  type: EventType,
  /** <= 200 chars, human readable, safe to render untrusted (data, never instruction). */
  summary: z.string().max(MAX_SUMMARY_CHARS),
  /** Structured, small payload. Never > 4 KB serialized. */
  payload: z.record(z.unknown()).default({}),
  /** sha256 hash of an offloaded blob, or null. */
  blobRef: z.string().nullable().default(null),
  /** Optional token estimate for context accounting. */
  tokensEst: z.number().int().nonnegative().optional(),
});
export type NormalizedEvent = z.infer<typeof NormalizedEvent>;

/**
 * Event as emitted by an adapter — seq/ts/sessionId are assigned by the hub.
 */
export const EmittedEvent = NormalizedEvent.omit({
  seq: true,
  sessionId: true,
  blobRef: true,
}).extend({
  ts: z.string().min(1).optional(),
  blobRef: z.string().nullable().optional(),
});
export type EmittedEvent = z.infer<typeof EmittedEvent>;

/** Reference to an offloaded blob (raw stdout, large tool outputs, …). */
export interface BlobRef {
  /** sha256 hex of the content. */
  hash: string;
  /** Content byte length. */
  bytes: number;
  /** Relative path under the session blob directory. */
  path: string;
}

export const BLOB_HASH_PREFIX = "sha256:";

export function blobRefToString(ref: BlobRef): string {
  return `${BLOB_HASH_PREFIX}${ref.hash}`;
}
