import type { ReviewAnchorState, ReviewNote } from "@ancientvoid/contracts";
import type { DiffHunk, SessionDiffFile, SessionDiffResult } from "../sessions/diff.ts";

/**
 * EPIC-P36 T36.2 / ADR-0055 §2: Anker-Wiedervorlage gegen den aktuellen
 * Diff. Reine Funktionen — kein git, kein IO. Regeln:
 * - Basis (`baseRef`) weicht → alles stale.
 * - Commit-Scopes sind immutabel: gültig, solange Commit + Datei im
 *   Abschnitt liegen. Gleiche Datei/Zeile in zwei Commits kollidiert nicht.
 * - Uncommitteter Rest: Identität über headSha + Inhaltsabgleich. Der
 *   Ausschnitt muss im Umfeld des Ankers (± Fenster) stehen — verschoben
 *   oder weg → stale, nie automatisch umgebogen.
 * - Nicht prüfbar (K3-gekürzte Hunks, HEAD unbestimmbar) → unclear,
 *   sichtbar, nicht versteckt.
 */

export const ANCHOR_WINDOW_LINES = 15;

/** Historisch: Suchfenster beim Umziehen-Erkennen. Heute zeilengenau
 * verglichen; die Konstante bleibt dokumentierter Teil der Anker-Semantik. */

export interface AnchorVerdict {
  anchorState: ReviewAnchorState;
  staleReason: string | null;
}

/** Eine Unified-Diff-Zeile mit Seiten-Nummern aus dem Hunk-Header abgeleitet. */
export interface SideLine {
  oldLine: number | null;
  newLine: number | null;
  text: string;
}

export function hunkSideLines(hunk: DiffHunk): SideLine[] {
  const out: SideLine[] = [];
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;
  for (const raw of hunk.body.split("\n")) {
    if (raw.startsWith("\\")) continue; // "\ No newline at end of file"
    if (raw.startsWith("-")) {
      out.push({ oldLine, newLine: null, text: raw.slice(1) });
      oldLine += 1;
    } else if (raw.startsWith("+")) {
      out.push({ oldLine: null, newLine, text: raw.slice(1) });
      newLine += 1;
    } else if (raw.startsWith(" ")) {
      out.push({ oldLine, newLine, text: raw.slice(1) });
      oldLine += 1;
      newLine += 1;
    }
  }
  return out;
}

const normalize = (text: string): string => text.trim().replace(/\s+/g, " ");

const lineNo = (line: SideLine, side: "old" | "new"): number | null => (side === "old" ? line.oldLine : line.newLine);

function linesOnSide(file: SessionDiffFile, side: "old" | "new", start: number, end: number): string[] {
  const out: string[] = [];
  for (const hunk of file.hunks) {
    for (const line of hunkSideLines(hunk)) {
      const n = lineNo(line, side);
      if (n !== null && n >= start && n <= end) out.push(line.text);
    }
  }
  return out;
}

function anchorRangePresent(file: SessionDiffFile, side: "old" | "new", start: number, end: number): boolean {
  return file.hunks
    .flatMap(hunkSideLines)
    .some((l) => {
      const n = lineNo(l, side);
      return n !== null && n >= start && n <= end;
    });
}

function excerptSomewhere(file: SessionDiffFile, excerpt: string): boolean {
  const haystack = normalize(file.hunks.map((h) => h.body).join("\n").replace(/^[+-\\ ]/gm, ""));
  return haystack.includes(normalize(excerpt));
}

const short = (sha: string): string => sha.slice(0, 8);

export function validateNote(note: ReviewNote, diff: SessionDiffResult, currentHead: string | null): AnchorVerdict {
  const stale = (reason: string): AnchorVerdict => ({ anchorState: "stale", staleReason: reason });
  const unclear = (reason: string): AnchorVerdict => ({ anchorState: "unclear", staleReason: reason });
  const valid = (): AnchorVerdict => ({ anchorState: "valid", staleReason: null });

  if (diff.error) return stale(`Diff nicht bestimmbar: ${diff.error}`);
  if (note.basis.baseRef !== diff.baseRef) {
    return stale(`Diff-Basis hat sich geändert (${short(note.basis.baseRef)} → ${short(diff.baseRef)})`);
  }

  let files: SessionDiffFile[];
  const scope = note.basis.scope;
  if (scope.kind === "commit") {
    const hit = diff.commits.find((c) => c.sha === scope.sha);
    if (!hit) return stale("Commit liegt nicht mehr im Diff-Bereich (Rebase/Reset oder Basis geändert)");
    files = hit.files;
    const file = files.find((f) => f.path === note.anchor.path);
    if (!file) return stale("Datei fehlt im Commit-Abschnitt");
    if (file.binary) return stale("Datei ist binär");
    return valid();
  }

  // uncommitteter Rest
  if (note.basis.headSha && currentHead && note.basis.headSha !== currentHead) {
    return stale(`HEAD hat sich geändert (${short(note.basis.headSha)} → ${short(currentHead)}) — uncommitteten Rest neu ansehen`);
  }
  if ((note.basis.headSha || currentHead) && (!note.basis.headSha || !currentHead)) {
    return unclear("HEAD nicht vergleichbar (damals oder jetzt unbekannt)");
  }
  const file = diff.files.find((f) => f.path === note.anchor.path);
  if (!file) return stale("Datei ist nicht mehr im uncommitteten Diff (umbenannt, gelöscht oder inzwischen committet)");
  if (file.binary) return stale("Datei ist jetzt binär");
  if (file.hunks.length === 0) return stale("Datei hat keine offenen Hunks mehr");
  if (file.hunks.some((h) => h.collapsed)) {
    return unclear("Hunks des Diff sind gekürzt (K3) — Anker unprüfbar, Hunk vollständig laden");
  }
  if (!anchorRangePresent(file, note.anchor.side, note.anchor.startLine, note.anchor.endLine)) {
    if (note.anchor.excerpt && excerptSomewhere(file, note.anchor.excerpt)) {
      return stale("Ankerumfeld existiert noch, aber an anderer Stelle — Zeilen sind gewandert, neu verankern");
    }
    return stale("Ankerbereich existiert nicht mehr im aktuellen Diff");
  }
  if (note.anchor.excerpt) {
    // Zeilengenauer Vergleich: die Zeilen des Ankerbereichs müssen den
    // Ausschnitt noch tragen — ein Teilstring-Treffer in einer GEÄNDERTEN
    // Zeile („beta“ in „beta geändert“) ist kein gültiger Anker.
    const rangeText = normalize(linesOnSide(file, note.anchor.side, note.anchor.startLine, note.anchor.endLine).join("\n"));
    if (rangeText !== normalize(note.anchor.excerpt)) {
      if (excerptSomewhere(file, note.anchor.excerpt)) {
        return stale("Ankerumfeld stimmt nicht mehr überein (geändert oder verschoben) — neu verankern");
      }
      return stale("Ankerumfeld stimmt nicht mehr überein (Inhalt geändert)");
    }
  }
  return valid();
}
