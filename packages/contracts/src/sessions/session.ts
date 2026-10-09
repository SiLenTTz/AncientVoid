import { z } from "zod";
import { SessionMetricsState } from "./metrics.ts";
import type { PromptAttachment } from "../attachments/attachment.ts";
import { CONTROL_MODES, DEFAULT_HOST_ID, HARNESS_TARGETS, RESUME_SCHEMA_VERSION } from "./identity.ts";

export const SESSION_STATUSES = [
  "idle",
  "starting",
  "working",
  "waiting_approval",
  "parked",
  "stopping",
  "stopped",
  "error",
] as const;

export const SessionStatus = z.enum(SESSION_STATUSES);
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/**
 * A POSIX-legal env var name — the same pattern `TmuxRunner.spawn()`
 * (`packages/workers/src/tmux.ts`) enforces as its own last line of
 * defense against shell injection (a red-team review, 2026-09-18, found
 * an unvalidated env KEY reaching an interpolated shell command string —
 * `X=$(evil)` as a "key" ran the command). Validating it here too rejects
 * the same bad input early (a clean 400 at session creation) instead of
 * only late (a confusing session.start_failed deep inside the runner) —
 * defense in depth, not a replacement for the runner's own check.
 */
export const ENV_VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Adapter-neutral session creation request (API body / hubctl input). */
export const SessionSpec = z.object({
  /** Registered adapter id (e.g. "dummy", "claude", "codex"). */
  adapter: z.string().min(1),
  /** Absolute or repo-relative project path the session works in. */
  project: z.string().min(1),
  /** Initial prompt (optional — some adapters start idle). */
  prompt: z.string().optional(),
  /** Model override, adapter-specific meaning. */
  model: z.string().optional(),
  /** Hard budget cap in USD (enforced from P2; stored from P0). */
  budgetUsd: z.number().positive().nullable().optional(),
  /** Additional env vars for the session worker. */
  env: z.record(z.string().regex(ENV_VAR_NAME), z.string()).optional(),
  /** Adapter-specific free-form arguments, validated by the adapter itself. */
  args: z.record(z.string(), z.unknown()).optional(),
  /**
   * Adoption (ADR-0011): continue a session the hub only observed so far.
   * `nativeSessionId` of the external run; the first prompt resumes it
   * (opencode `--session`, claude `--resume`). Adapters that cannot resume
   * refuse this via refuseSpec (unsupportedResume).
   */
  adoptNativeSessionId: z.string().min(1).optional(),
  /** Read-only mirror (ADR-0011 Erweiterung): show an externally observed
   * opencode session's conversation in the hub chat without adopting it —
   * history and updates come from opencode's own store, nothing is run. */
  mirrorNativeSessionId: z.string().min(1).optional(),
  /** T7.10: files for the first prompt — resolved by the hub from the
   * uploaded attachment ids (clients send `attachmentIds`). */
  attachments: z.array(z.custom<PromptAttachment>()).optional(),
});
export type SessionSpec = z.infer<typeof SessionSpec>;

/** Persisted session record (SQLite `sessions` table, P0 data model). */
export const SessionRecord = z.object({
  id: z.string().min(1),
  adapter: z.string().min(1),
  project: z.string().min(1),
  worktreeSha: z.string().nullable(),
  model: z.string().nullable(),
  /** ADR-0033: the permission mode this session runs in (provider-specific
   * name), null when the adapter has none. */
  permissionMode: z.string().nullable().default(null),
  status: SessionStatus,
  createdAt: z.string().min(1),
  budgetUsd: z.number().positive().nullable(),
  adapterVersion: z.string().min(1),
  /** Last known event seq — used for K7 state restore. */
  lastSeq: z.number().int().nonnegative().default(0),
  /** Sum of every event's costUsd so far (ADR-0003). 0 for adapters that
   * never report a native cost (e.g. codex, T1.3) — "0" here means
   * "nothing billed via this field," not "confirmed free." */
  costUsd: z.number().nonnegative().default(0),
  /** Sum of every event's tokensEst so far (ADR-0006) — same "0 means
   * unreported, not confirmed zero" caveat as costUsd. */
  tokensEst: z.number().nonnegative().default(0),
  /** T7.7 (ADR-0023): how far costUsd/tokensEst can be trusted — "unknown"
   * means the 0 above is not a value. Derived from `counters`. */
  metrics: SessionMetricsState.prefault({ cost: "unknown", tokens: "unknown", counters: {} }),
  /** ISO-8601 timestamp of the last persisted change to this session
   * (status change or event) — T1.5's "zuletzt aktiv" sort key. */
  updatedAt: z.string().min(1),
  /** T2.7/ADR-0008: why a "parked" session is paused — null for every
   * other status, or for a manually parked session that predates this
   * field. Distinguishes a manual park() from an automatic budget/
   * daily-cap park so a budget top-up never auto-resumes a session that
   * was parked for an unrelated reason. */
  parkReason: z.enum(["manual", "budget", "daily_cap"]).nullable().default(null),
  /** ADR-0011. Defaults keep every pre-P5 row and caller valid. */
  controlMode: z.enum(CONTROL_MODES).default("managed"),
  harness: z.enum(HARNESS_TARGETS).default("cli"),
  hostId: z.string().min(1).default(DEFAULT_HOST_ID),
  nativeSessionId: z.string().nullable().default(null),
  resumeVersion: z.number().int().nonnegative().default(RESUME_SCHEMA_VERSION),
  logOffset: z.number().int().nonnegative().nullable().default(null),
  parentSessionId: z.string().nullable().default(null),
  observedAt: z.string().nullable().default(null),
  fork: z.boolean().default(false),
  inputRevision: z.number().int().nonnegative().default(0),
  writerClient: z.string().nullable().default(null),
  writerLeaseUntil: z.string().nullable().default(null),
  /** Hidden from the overview list. The session and its events stay. */
  archived: z.boolean().default(false),
  /** First line of the start prompt, for the overview. Null when the
   * session started without one (or before titles existed). */
  title: z.string().nullable().default(null),
  /** T8.1: the last understandable thing that happened — what the card
   * shows instead of an event number. */
  lastActivity: z.object({ text: z.string().max(160), type: z.string(), at: z.string() }).nullable().default(null),
  /** T8.6: pinned to the top of the overview (on this hub, all devices). */
  pinned: z.boolean().default(false),
});
export type SessionRecord = z.infer<typeof SessionRecord>;

/**
 * Snapshot enabling K7 (100 % state restore in < 3 s after hard kill).
 * Persisted next to the JSONL stream; JSONL remains the source of truth.
 */
export interface SessionSnapshot {
  sessionId: string;
  status: SessionStatus;
  lastSeq: number;
  adapterVersion: string;
  savedAt: string;
  controlMode: string;
  nativeSessionId: string | null;
  resumeVersion: number;
  inputRevision: number;
}
