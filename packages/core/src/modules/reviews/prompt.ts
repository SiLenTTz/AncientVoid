import type { ReviewNote } from "@ancientvoid/contracts";

/**
 * EPIC-P36 / ADR-0055 §3: der gebündelte Folgeprompt. Reine Funktion —
 * deterministisch, ohne Zeitstempel, damit Vorschau und gesendeter Text
 * identisch sind. Der kompakte Prompt bleibt unter der Inline-Schwelle;
 * alles Größere geht als vollständiges Paket (Blob/Anhang) mit.
 */

export const REVIEW_PROMPT_INLINE_MAX_CHARS = 3_000;

const scopeLabel = (note: ReviewNote): string =>
  note.basis.scope.kind === "commit" ? `Commit ${note.basis.scope.sha.slice(0, 8)}` : "nicht committete Änderungen";

const sideLabel = (side: "old" | "new"): string => (side === "old" ? "alte" : "neue");

export function formatReviewNoteRef(note: ReviewNote): string {
  const lines =
    note.anchor.startLine === note.anchor.endLine
      ? `Zeile ${note.anchor.startLine}`
      : `Zeilen ${note.anchor.startLine}–${note.anchor.endLine}`;
  const excerpt = note.anchor.excerpt ? ` · Ausschnitt: „${note.anchor.excerpt}“` : "";
  return `${note.anchor.path} · ${sideLabel(note.anchor.side)} ${lines} · ${scopeLabel(note)}${excerpt}`;
}

/** Kompakter Sammelprompt für den Steer-Versand. */
export function composeFeedbackPrompt(notes: ReviewNote[]): string {
  const head = `Sammel-Review mit ${notes.length} ${notes.length === 1 ? "Befund" : "Befunden"} aus der Diff-Ansicht:`;
  const items = notes.map((note, i) => `${i + 1}. [${formatReviewNoteRef(note)}]\n   ${note.text.trim()}`);
  return `${head}\n${items.join("\n")}\n\nBitte jeden Befund abarbeiten und dazu kurz Stellung nehmen.`;
}

/** Vollständiges Paket (Markdown) für den Anhang, wenn der Prompt zu groß wird. */
export function composeFeedbackPackage(notes: ReviewNote[]): string {
  const sections = notes.map((note, i) => {
    const lines = [
      `## Befund ${i + 1}: ${note.anchor.path}`,
      "",
      `- Bezug: ${formatReviewRefFull(note)}`,
      `- Angelegt: ${note.createdAt}`,
      "",
      note.text.trim(),
    ];
    return lines.join("\n");
  });
  return [`# Review-Feedback (${notes.length} Befunde)`, "", ...sections].join("\n\n");
}

function formatReviewRefFull(note: ReviewNote): string {
  const basis =
    note.basis.scope.kind === "commit"
      ? `Commit ${note.basis.scope.sha} (Basis ${note.basis.baseRef})`
      : `nicht committete Änderungen (HEAD ${note.basis.headSha ?? "unbekannt"}, Basis ${note.basis.baseRef})`;
  return `${basis}, ${sideLabel(note.anchor.side)} Zeilen ${note.anchor.startLine}–${note.anchor.endLine}`;
}

/** true, wenn der kompakte Prompt die Inline-Schwelle sprengt → Paket anhängen. */
export function promptNeedsAttachment(notes: ReviewNote[]): boolean {
  return composeFeedbackPrompt(notes).length > REVIEW_PROMPT_INLINE_MAX_CHARS;
}
