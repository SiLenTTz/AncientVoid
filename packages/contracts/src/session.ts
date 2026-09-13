import { z } from "zod";

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
  env: z.record(z.string()).optional(),
  /** Adapter-specific free-form arguments, validated by the adapter itself. */
  args: z.record(z.unknown()).optional(),
});
export type SessionSpec = z.infer<typeof SessionSpec>;

/** Persisted session record (SQLite `sessions` table, P0 data model). */
export const SessionRecord = z.object({
  id: z.string().min(1),
  adapter: z.string().min(1),
  project: z.string().min(1),
  worktreeSha: z.string().nullable(),
  model: z.string().nullable(),
  status: SessionStatus,
  createdAt: z.string().min(1),
  budgetUsd: z.number().positive().nullable(),
  adapterVersion: z.string().min(1),
  /** Last known event seq — used for K7 state restore. */
  lastSeq: z.number().int().nonnegative().default(0),
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
}
