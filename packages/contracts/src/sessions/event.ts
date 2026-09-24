import { z } from "zod";
import { MetricSource } from "./metrics.ts";

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
/**
 * One rolling usage window an adapter-account is measured against, e.g.
 * claude's real "five_hour"/"seven_day" rate-limit windows (ADR-0004).
 * `id` is a free string, not an enum — future adapters (zai, swarm,
 * local-llm) will have different windows (daily, monthly, a credit pool
 * with no reset). The PWA translates known ids, shows unknown ones raw.
 */
export const UsageWindow = z.object({
  id: z.string().min(1),
  /** 0.0-1.0 — fraction of this window already consumed. */
  utilization: z.number().min(0).max(1),
  /** ISO-8601. Never omitted — a window without a reset time would
   * silently read as "never expires", which is a claim, not an absence. */
  resetsAt: z.string().min(1),
});
export type UsageWindow = z.infer<typeof UsageWindow>;

/**
 * Account-level usage/quota snapshot (ADR-0004). Carried on an event only
 * because that's the sole way claude's CLI ever reveals it (no on-demand
 * query exists) — the hub caches the latest one per adapter id, keyed by
 * `Adapter.id`, NOT accumulated onto any SessionRecord (rate limits are
 * shared across every session of that adapter-account, unlike costUsd).
 */
export const UsageQuota = z.object({
  windows: z.array(UsageWindow).min(1),
  /** Can the account keep going past its windows via paid overage?
   * Answers the API-budget half of "when do I hit $0". Undefined means
   * unknown, never implies "no". */
  overageAvailable: z.boolean().optional(),
  /** Human-readable reason overage is blocked, if known (e.g. the real
   * observed "out_of_credits"). */
  overageBlockedReason: z.string().optional(),
});
export type UsageQuota = z.infer<typeof UsageQuota>;

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
  /**
   * Optional real cost of THIS event/turn in USD, provider-neutral
   * (ADR-0003). Not cumulative — the hub sums it into
   * SessionRecord.costUsd. Adapters without a native cost figure (e.g.
   * codex, T1.3) leave it undefined; claiming a guessed value here would
   * be the "capabilities() promises more than it holds" anti-pattern.
   */
  costUsd: z.number().nonnegative().optional(),
  /** T7.7 (ADR-0023): where tokensEst/costUsd came from; absent = the
   * provider's own report (`native`). A price table is `estimated`. */
  tokensSource: MetricSource.optional(),
  costSource: MetricSource.optional(),
  /** Optional account-level usage/quota snapshot (ADR-0004). See UsageQuota. */
  usageQuota: UsageQuota.optional(),
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
