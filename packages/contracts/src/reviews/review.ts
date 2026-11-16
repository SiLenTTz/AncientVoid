import { z } from "zod";

/**
 * EPIC-P36 / ADR-0055: eine Review-Notiz mit Diff-Identität. Die Notiz ist
 * an einen konkreten Abschnitt der Diff-Ansicht gebunden — Commit-SHA oder
 * uncommitteter Rest — und trägt neben Pfad/Seite/Zeilenbereich einen
 * begrenzten Ausschnitt des Ankerumfelds. Zeilennummern allein sind kein
 * Identitätsnachweis: Nach einer Diff-Änderung entscheidet der Abgleich
 * (Scope, Pfad, Ausschnitt), ob der Anker noch gültig oder sichtbar veraltet
 * ist — verschoben wird nie automatisch.
 */

/** Maximal mitgespeicherter Anker-Textausschnitt (Zeichen). */
export const REVIEW_EXCERPT_MAX_CHARS = 400;
/** Maximaler Notiztext (Zeichen) — Notizen sind Kommentare, keine Dokumente. */
export const REVIEW_NOTE_MAX_CHARS = 4_000;

export const ReviewScope = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("commit"), sha: z.string().regex(/^[0-9a-f]{6,40}$/) }),
  z.object({ kind: z.literal("uncommitted") }),
]);
export type ReviewScope = z.infer<typeof ReviewScope>;

export const ReviewAnchor = z.object({
  path: z.string().min(1),
  /** Welche Diff-Seite der Bereich meint (alt/neu). */
  side: z.enum(["old", "new"]),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  /** Begrenzter Textausschnitt um den Anker zum Wiedererkennen. */
  excerpt: z.string().max(REVIEW_EXCERPT_MAX_CHARS),
});
export type ReviewAnchor = z.infer<typeof ReviewAnchor>;

/** Menschlicher Review-Status — „done" ist kein Testergebnis (ADR-0055 §7). */
export const REVIEW_NOTE_STATUSES = ["draft", "sent", "open", "done"] as const;
export type ReviewNoteStatus = (typeof REVIEW_NOTE_STATUSES)[number];

export const ReviewNote = z.object({
  id: z.string().uuid(),
  sessionId: z.string().min(1),
  /** Diff-Identität zum Zeitpunkt der Notiz (ADR-0055 §1). */
  basis: z.object({
    baseRef: z.string().min(1),
    /** HEAD des Workdir bei Notizanlage — Identität des uncommitteten Rests. */
    headSha: z.string().regex(/^[0-9a-f]{6,40}$/).nullable(),
    scope: ReviewScope,
  }),
  anchor: ReviewAnchor,
  text: z.string().min(1).max(REVIEW_NOTE_MAX_CHARS),
  status: z.literal(REVIEW_NOTE_STATUSES),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  /** Letzter Sammelversand, an dem diese Notiz teilnahm. */
  sentAt: z.string().min(1).nullable(),
  operationId: z.string().min(1).nullable(),
  /** Warum ein Versand gescheitert ist / warum der Anker veraltet — sichtbar, nie still. */
  sendDetail: z.string().nullable(),
});
export type ReviewNote = z.infer<typeof ReviewNote>;

/** Ergebnis der Anker-Wiedervorlage gegen den aktuellen Diff. */
export const REVIEW_ANCHOR_STATES = ["valid", "stale", "unclear"] as const;
export type ReviewAnchorState = (typeof REVIEW_ANCHOR_STATES)[number];

/** Eine Notiz samt aktueller Anker-Bewertung (Server-Ansicht). */
export type ReviewNoteView = ReviewNote & {
  anchorState: ReviewAnchorState;
  /** Benannter Grund, wenn der Anker veraltet oder unklar ist. */
  staleReason: string | null;
};

export const CreateReviewNoteInput = z.object({
  basis: z.object({
    baseRef: z.string().min(1),
    /** Optional: Der Hub trägt den aktuellen HEAD nach — die PWA kennt ihn nicht. */
    headSha: z.string().regex(/^[0-9a-f]{6,40}$/).nullish(),
    scope: ReviewScope,
  }),
  anchor: ReviewAnchor,
  text: z.string().min(1).max(REVIEW_NOTE_MAX_CHARS),
});
export type CreateReviewNoteInput = z.infer<typeof CreateReviewNoteInput>;

export const SetReviewNoteStatusInput = z.object({
  status: z.literal(REVIEW_NOTE_STATUSES),
});

/** Ein Sammelversand: gewählte Notizen, Empfänger, Operations-ID (ADR-0055 §3). */
export const SendReviewFeedbackInput = z.object({
  noteIds: z.array(z.string().uuid()).min(1),
  /** Empfänger-Session; Default/leer = die geprüfte Session selbst. */
  targetSessionId: z.string().min(1).optional(),
  /** operationsId = Steer-inputId: verhindert Doppelversand nach Doppelklick/Reconnect. */
  operationId: z.string().min(8).max(128),
});
export type SendReviewFeedbackInput = z.infer<typeof SendReviewFeedbackInput>;
