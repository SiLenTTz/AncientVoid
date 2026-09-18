import { z } from "zod";

/**
 * T4.1 (EPIC-P4 §3 "Brain-Digest") / ADR-0009 — the entire boundary between
 * the OSS hub core and any external consumer of a completed session's
 * summary (a knowledge base, a chat notification, a dashboard). The hub
 * knows a session finished and produces a SessionSummary; it never knows
 * or cares what a sink does with one. "Brain ist ein Konsument, kein
 * Bestandteil" — no Brain-specific field, no vault path, nothing here.
 */

export const DIGEST_LESSON_KINDS = ["decision", "failure", "budget", "approval"] as const;
export const DigestLessonKind = z.enum(DIGEST_LESSON_KINDS);
export type DigestLessonKind = (typeof DIGEST_LESSON_KINDS)[number];

/** One quote-grounded observation extracted from a session's real event
 * log — never free-text summarization (this repo has no LLM capability to
 * do that honestly; see ADR-0009). `eventSeq` is the whole point: a
 * consumer can always trace a lesson back to the exact real events that
 * produced it. */
/**
 * `text` is copied verbatim from a real event's `summary` — which can
 * ultimately originate from an untrusted CLI subprocess's own output
 * (I-1, red-team review, 2026-09-18, T4.10). It reaches a sink as inert
 * JSON, never templated or eval'd by the hub itself — but a sink that
 * feeds `lessons[].text` back into another LLM without labeling it as
 * untrusted agent output would be reintroducing prompt injection on the
 * consumer's own side, not the hub's. Render/forward it as data.
 */
export const DigestLesson = z.object({
  kind: DigestLessonKind,
  text: z.string().min(1),
  eventSeq: z.array(z.number().int().nonnegative()).min(1),
});
export type DigestLesson = z.infer<typeof DigestLesson>;

export const SessionSummary = z.object({
  sessionId: z.string().min(1),
  adapter: z.string().min(1),
  project: z.string().min(1),
  model: z.string().nullable(),
  startedAt: z.string().min(1),
  endedAt: z.string().min(1),
  costUsd: z.number().nonnegative(),
  tokensEst: z.number().nonnegative(),
  eventCount: z.number().int().nonnegative(),
  lessons: z.array(DigestLesson),
  /** Relative path from the hub's dataDir to the raw JSONL event archive
   * (EventStore's own `sessions/<id>/events.jsonl` convention) — a
   * reference, never the full event content (ADR-0009). */
  archiveRef: z.string().min(1),
});
export type SessionSummary = z.infer<typeof SessionSummary>;

/**
 * A reporting sink is called once per completed session. Fire-and-forget,
 * best-effort: SessionManager never lets a throwing/rejecting sink affect
 * session lifecycle (see ADR-0009 and SessionManager.stop()).
 */
export type ReportingSink = (summary: SessionSummary) => void | Promise<void>;
