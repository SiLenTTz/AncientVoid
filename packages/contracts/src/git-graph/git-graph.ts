/** ADR-0071: Git-Commit-Graph (Branches/Merges) — nicht der Datei-Import-Graph (ADR-0062). */

export interface GitGraphFile {
  /** Posix-relativer Pfad zur Repo-Wurzel. */
  path: string;
  /** Ein Buchstabe wie bei `git diff-tree --name-status` (A/M/D/R/C/T/U). */
  status: string;
}

export interface GitGraphCommit {
  sha: string;
  shortSha: string;
  /** Eltern-SHAs; zwei oder mehr = Merge. */
  parents: string[];
  author: string;
  /** ISO-8601 Autor-Datum. */
  date: string;
  subject: string;
  /** Branch-/Tag-Namen, die auf diesen Commit zeigen. */
  refs: string[];
  files: GitGraphFile[];
  /** true, wenn mehr Dateien existierten als geliefert. */
  filesTruncated?: boolean;
}

export interface GitGraphBranch {
  name: string;
  sha: string;
  /** Stabile Index-Farbe für die PWA-Linienpalette. */
  colorIndex: number;
}

export interface GitGraphReport {
  commits: GitGraphCommit[];
  branches: GitGraphBranch[];
  /** Aktueller HEAD-SHA, falls auflösbar. */
  head: string | null;
  truncated: boolean;
  maxCommits: number;
  /** Benannter Grund, wenn kein Graph möglich ist (kein Repo, leerer Verlauf …). */
  error?: string;
}

/** Cap für Commits in einer Antwort — Überschreitung → `truncated`. */
export const GIT_GRAPH_MAX_COMMITS = 120;
/** Cap für Dateien je Commit — Überschreitung → `filesTruncated`. */
export const GIT_GRAPH_MAX_FILES_PER_COMMIT = 40;
