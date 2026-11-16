import { z } from "zod";

/**
 * T8.4 / ADR-0025: an unsent reply, shared by every device of this hub.
 * A draft is never a send order: it only ever fills the input field.
 * `revision` guards against silent overwrites between two devices.
 */
export const DRAFT_MAX_CHARS = 20_000;

export const SessionDraft = z.object({
  sessionId: z.string().min(1),
  text: z.string().max(DRAFT_MAX_CHARS),
  attachmentIds: z.array(z.string()).max(20),
  /** 0 = no draft stored yet. */
  revision: z.number().int().nonnegative(),
  updatedAt: z.string().nullable(),
  /** Device label of the last writer (never the token). */
  device: z.string().nullable(),
});
export type SessionDraft = z.infer<typeof SessionDraft>;

export const SaveDraftInput = z.object({
  text: z.string().max(DRAFT_MAX_CHARS),
  attachmentIds: z.array(z.string().regex(/^[0-9a-f]{64}$/)).max(20).default([]),
  /** The revision this edit started from. */
  baseRevision: z.number().int().nonnegative(),
});
export type SaveDraftInput = z.infer<typeof SaveDraftInput>;
