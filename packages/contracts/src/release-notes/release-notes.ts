/** ADR-0093: Release-Notes — gemergte PRs aus dem lokalen Git-Verlauf;
 * Commit-Notation (docs/commit-notation.md) als strukturierte Basis.
 * Merge-Commit-Subject = PR-Titel (mit `(#N)`), Merge-Body = PR-Beschreibung. */

/** Risiko-Stufen aus docs/commit-notation.md. */
export type NotationRisk = "." | "^" | "!" | "@";
/** Absichten aus docs/commit-notation.md; `m` = Merge-/PR-Titel. */
export type NotationIntent = "F" | "B" | "r" | "d" | "t" | "e" | "a" | "m";

export interface CommitNotation {
  /** Original-Subject, unverändert. */
  raw: string;
  risk: NotationRisk | null;
  intent: NotationIntent | null;
  /** Bereich in Kleinbuchstaben, z. B. `pwa`, `adapter-claude`, `hub/pwa`, `epic-p7`. */
  area: string | null;
  /** Satz nach `bereich: `; bei unparsed das ganze Subject. */
  summary: string;
  /** PR-Nummer aus `(#N)` am Subject-Ende, wenn vorhanden — nie geraten. */
  prNumber: number | null;
  /** true, wenn das Subject nicht der Notation folgt — wird roh gezeigt, nie gefiltert. */
  unparsed: boolean;
}

/** Aus `git diff --shortstat` (null, wenn die Zeile fehlt/unlesbar — nicht geraten). */
export interface ReleaseNotesStats {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

/** Ein Branch-Commit eines PRs (`git log P1..P2`, älteste zuerst). */
export interface ReleaseNotesCommit {
  sha: string;
  shortSha: string;
  author: string;
  /** ISO-8601 Autor-Datum. */
  date: string;
  notation: CommitNotation;
  /** Commit-Body (Begründung), gekürzt auf RELEASE_NOTES_BODY_CAP. */
  body: string;
  bodyTruncated: boolean;
}

/** name-status wie bei git-graph (ADR-0071). */
export interface ReleaseNotesFile {
  path: string;
  status: string;
}

/** Ein PR in der Liste (Merge-Commit auf dem Hauptstrang) — ohne Bodies (K5-Geist). */
export interface ReleaseNotesEntry {
  mergeSha: string;
  shortSha: string;
  mergedAt: string;
  mergedBy: string;
  notation: CommitNotation;
  stats: ReleaseNotesStats | null;
}

export interface ReleaseNotesListReport {
  /** Neueste zuerst. */
  entries: ReleaseNotesEntry[];
  truncated: boolean;
  maxEntries: number;
  /** Benannter Grund, wenn keine Liste möglich ist (kein Repo, leerer Verlauf …). */
  error?: string;
}

/** Detail zu einem PR — wird erst beim Aufklappen geladen. */
export interface ReleaseNotesDetail {
  mergeSha: string;
  mergedAt: string;
  notation: CommitNotation;
  /** PR-Beschreibung (Body des Merge-Commits) — das „Warum“ auf PR-Ebene. */
  body: string;
  bodyTruncated: boolean;
  commits: ReleaseNotesCommit[];
  commitsTruncated: boolean;
  files: ReleaseNotesFile[];
  filesTruncated: boolean;
  stats: ReleaseNotesStats | null;
}

/** Cap für PRs in einer Listen-Antwort — Überschreitung → `truncated`. */
export const RELEASE_NOTES_MAX_ENTRIES = 50;
/** Cap für Branch-Commits je PR-Detail — Überschreitung → `commitsTruncated`. */
export const RELEASE_NOTES_MAX_COMMITS = 50;
/** Cap für Dateien je PR-Detail — Überschreitung → `filesTruncated`. */
export const RELEASE_NOTES_MAX_FILES = 60;
/** Cap für einen Body (PR und Commit) in Zeichen — Überschreitung → `bodyTruncated`. */
export const RELEASE_NOTES_BODY_CAP = 8_000;
