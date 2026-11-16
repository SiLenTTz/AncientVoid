import type { ComponentChildren } from "preact";
import type { SessionDiffResult, SessionRecord } from "../../shared/api.ts";
import { ApplyToProject } from "./HostCommands.tsx";

/**
 * EPIC-P43 T43.5: Umfang der Änderungen einer Session — Union aus Commits und uncommittetem Rest,
 * je Pfad einmal (wie die Sprungliste in DiffPane). null, solange der Diff lädt oder fehlschlägt.
 */
export function changeSummary(diff: SessionDiffResult | null): { files: number; additions: number; deletions: number } | null {
  if (!diff) return null;
  // Der Hub meldet einen leeren Diff als `error` „keine Änderungen …“ — das ist ein Befund, kein Fehler.
  if (diff.error && !diff.error.startsWith("keine Änderungen")) return null;
  const seen = new Map<string, { additions: number; deletions: number }>();
  for (const f of [...(diff.commits ?? []).flatMap((c) => c.files), ...diff.files]) {
    const prev = seen.get(f.path) ?? { additions: 0, deletions: 0 };
    seen.set(f.path, { additions: prev.additions + (f.additions ?? 0), deletions: prev.deletions + (f.deletions ?? 0) });
  }
  let additions = 0;
  let deletions = 0;
  for (const v of seen.values()) {
    additions += v.additions;
    deletions += v.deletions;
  }
  return { files: seen.size, additions, deletions };
}

/** Kopf von „Änderungen“: Zusammenfassung links, die eine Hauptaktion rechts (Kleinkram-Regel 4). */
export function ChangesHead({ diff, record, status, detach }: { diff: SessionDiffResult | null; record: SessionRecord; status: string; detach?: ComponentChildren }) {
  const sum = changeSummary(diff);
  return (
    <div class="view-head changes-head">
      <div class="changes-summary num">
        {sum === null ? (
          <span class="dim">{diff?.error ? "Diff nicht verfügbar" : "lädt…"}</span>
        ) : (
          <>
            {sum.files} {sum.files === 1 ? "Datei" : "Dateien"} · <span class="diff-add-count">+{sum.additions}</span> <span class="diff-del-count">−{sum.deletions}</span>
          </>
        )}
      </div>
      {record.worktree && <ApplyToProject sessionId={record.id} status={status} worktree={record.worktree} project={record.project} primary />}
      {/* Herauslösen steht immer als letzte Taste im Kopf (ADR-0068). */}
      {detach}
    </div>
  );
}
