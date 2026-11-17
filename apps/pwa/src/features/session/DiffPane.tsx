import { useMemo, useState } from "preact/hooks";
import { useApi } from "../../shared/api-context.ts";
import { type SessionDiffResult, type SessionDiffFile, type DiffCommit, type DiffHunk } from "../../shared/api.ts";
import { isOneSided, mapHunkLines, pairHunkLines, type MappedDiffLine } from "./diff-lines.ts";
import { Button, EmptyState } from "../../shared/ui/index.ts";

/** EPIC-P36: Zeilen-Anker für Review-Notizen. DiffPane bleibt Renderer —
 * Auswahlzustand und Notizlogik liegen in DiffReview.tsx. */
export interface LinePick {
  path: string;
  /** AC-P2-1: Commit-Abschnitt, zu dem die Zeile gehört (uncommittet → undefined). */
  commit?: string;
  side: "old" | "new";
  line: number;
  text: string;
}

export interface ReviewHooks {
  pickEnabled: boolean;
  onLinePick?: (pick: LinePick) => void;
  /** Aktuell markierter Bereich (gleicher Pfad/Commit) oder null. */
  picked: { path: string; commit?: string; side: "old" | "new"; start: number; end: number } | null;
  /** Anzahl Notizen je Datei (Badge in der Dateiliste). */
  noteCount: (path: string) => number;
}

/**
 * T1.6-5 → T2.3 (EPIC-P2 §4): per-file hunk cards, replacing the raw
 * concatenated-patch view. Each hunk shows git's own real function-context
 * anchor (T2.2) and, once collapsed under K3, a tap-to-expand button that
 * fetches the full hunk via GET /api/sessions/:id/diff/hunk.
 */
function HunkCard({
  sessionId,
  path,
  hunk,
  index,
  commit,
  review,
}: {
  sessionId: string;
  path: string;
  hunk: DiffHunk;
  index: number;
  /** AC-P2-1: Hunk gehört zu diesem Commit-Abschnitt — Expand lädt ihn
   * gegen sha^..sha statt gegen das Arbeitsverzeichnis. */
  commit?: string;
  review?: ReviewHooks;
}) {
  const api = useApi();
  const [expanded, setExpanded] = useState<DiffHunk | null>(null);
  const [loading, setLoading] = useState(false);
  const active = expanded ?? hunk;
  const rows = useMemo(() => pairHunkLines(active.body), [active.body]);
  const oneSided = useMemo(() => isOneSided(rows), [rows]);
  const mapped = useMemo(() => mapHunkLines(active), [active]);

  const onExpand = async () => {
    setLoading(true);
    try {
      const res = await api.sessionDiffHunk(sessionId, path, commit);
      const full = res.hunks[index];
      if (full) setExpanded(full);
    } catch {
      // stays collapsed — a failed expand is a no-op, not a crash
    } finally {
      setLoading(false);
    }
  };

  const isPicked = (line: MappedDiffLine): boolean => {
    if (!review?.picked || review.picked.path !== path || review.picked.commit !== commit) return false;
    const n = review.picked.side === "old" ? line.oldLine : line.newLine;
    return n !== null && n >= review.picked.start && n <= review.picked.end;
  };

  return (
    <div class={`hunk-card${oneSided ? " one-sided" : ""}`}>
      <div class="hunk-card-header mono">
        <span class="hunk-range">
          -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines}
        </span>
        <span class="hunk-fn">{active.functionContext ?? "—"}</span>
        {active.collapsed && (
          <Button  aria-busy={loading} onClick={onExpand} disabled={loading} class={loading ? "hunk-expand-btn busy" : "hunk-expand-btn"}>
            {loading ? "lädt…" : "ganzer Hunk"}
          </Button>
        )}
      </div>
      <div class="hunk-body-unified mono">
        {mapped.map((line, i) => {
          const cls = line.type === "add" ? "diff-line-add" : line.type === "del" ? "diff-line-del" : "diff-line-ctx";
          const picked = isPicked(line);
          const clickable = review?.pickEnabled && review.onLinePick;
          return (
            <div
              key={i}
              class={`${cls}${picked ? " review-picked" : ""}${clickable ? " review-pickable" : ""}`}
              onClick={
                clickable
                  ? () => {
                      const side = review.picked?.side ?? "new";
                      const n = side === "old" ? line.oldLine : line.newLine;
                      if (n !== null) review.onLinePick!({ path, commit, side, line: n, text: line.text });
                    }
                  : undefined
              }
            >
              {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
              {line.text}
            </div>
          );
        })}
      </div>
      <div class="hunk-body-split mono">
        {rows.map((row, i) => (
          <div class="hunk-split-row" key={i}>
            <span class={`hunk-split-cell ${row.left.type}`}>{row.left.text}</span>
            <span class={`hunk-split-cell ${row.right.type}`}>{row.right.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The anchor of a file's hunks — the list on the left jumps to it. */
const fileAnchor = (index: number) => `diff-file-${index}`;

function CommitHeading({ commit }: { commit: DiffCommit }) {
  return (
    <div class="diff-commit-heading">
      <span class="mono diff-commit-sha">{commit.shortSha}</span>
      <span class="diff-commit-subject">{commit.subject}</span>
      <span class="dim diff-commit-meta">
        {commit.author} · {new Date(commit.date).toLocaleString("de-DE")}
      </span>
    </div>
  );
}

export function DiffPane({
  diff,
  sessionId,
  review,
}: {
  diff: SessionDiffResult | null;
  sessionId: string;
  /** EPIC-P36: optionale Review-Hooks — ohne sie rendert DiffPane wie vorher. */
  review?: ReviewHooks;
}) {
  if (diff === null) return <EmptyState text="lädt …" />;
  if (diff.error) return <EmptyState text={diff.error} />;
  // AC-P2-1: ein Abschnitt pro Commit (ältester zuerst), danach der
  // uncommittete Rest. `diff.files` trägt seit der Umstellung nur noch
  // den uncommitteten Teil — die Sprungliste links ist die Union aus
  // beiden, dedupliziert pro Pfad (eine Datei kann in einem Commit UND
  // uncommittet geändert sein).
  const commits = diff.commits ?? [];
  const union: SessionDiffFile[] = [];
  const seen = new Set<string>();
  for (const f of [...commits.flatMap((c) => c.files), ...diff.files]) {
    if (seen.has(f.path)) continue;
    seen.add(f.path);
    union.push(f);
  }
  const preexisting = new Set(diff.baseline?.dirtyAtStart ?? []);
  const maxChange = Math.max(1, ...union.map((f) => (f.binary ? 0 : f.additions + f.deletions)));
  const anchorOf = new Map(union.map((f, i) => [f.path, i]));
  const groups = (files: SessionDiffFile[], commit?: string) =>
    files.map((f) => {
      const i = anchorOf.get(f.path) ?? 0;
      return f.binary || f.hunks.length === 0 ? null : (
        <div key={f.path} class="diff-file-group" id={fileAnchor(i)}>
          <div class="diff-file-heading mono">
            {f.path}
            {preexisting.has(f.path) && <span class="diff-preexisting" title="Schon vor dem Start geändert — nicht von dieser Session">vor Start geändert</span>}
            {review && review.noteCount(f.path) > 0 && <span class="review-note-badge">{review.noteCount(f.path)}</span>}
          </div>
          {f.hunks.map((h, j) => (
            <HunkCard key={`${f.path}:${j}`} sessionId={sessionId} path={f.path} hunk={h} index={j} commit={commit} review={review} />
          ))}
        </div>
      );
    });
  // EPIC-P20 T20.1: from 1280 px the file list sits beside the code (CSS), a click jumps to
  // the file. The phone keeps the stacked list; the rows only gain a jump there.
  const jump = (index: number) => {
    const root = document.querySelector(".tail-scroll");
    root?.querySelector(`[id="${fileAnchor(index)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <div class="diff-pane">
      {diff.baseline && diff.baseline.dirtyAtStart.length > 0 && (
        <div class="workplace-warn" role="note">
          Projekt direkt: {diff.baseline.dirtyAtStart.length}{diff.baseline.dirtyTruncated ? "+" : ""} Datei(en) waren beim Start schon geändert und sind markiert — sie zählen nicht als Leistung der Session.
        </div>
      )}
      <div class="diff-files">
        {union.map((f, i) => (
          <div
            key={f.path}
            class="diff-file-row"
            role="button"
            tabIndex={0}
            onClick={() => jump(i)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault();
                jump(i);
              }
            }}
          >
            <span class="mono">{f.path}</span>
            {f.binary ? (
              <span class="dim">binär</span>
            ) : (
              <span class="diff-file-counts">
                <span class="diff-add-count">+{f.additions}</span> <span class="diff-del-count">-{f.deletions}</span>
                {/* EPIC-P43 T43.5: Plus/Minus als Balken, Länge relativ zur größten Datei. */}
                <span class="diff-bar" aria-hidden="true" style={{ width: `${Math.max(4, Math.round(((f.additions + f.deletions) / maxChange) * 56))}px` }}>
                  <span class="add" style={{ flexGrow: f.additions }} />
                  <span class="del" style={{ flexGrow: f.deletions }} />
                </span>
              </span>
            )}
          </div>
        ))}
      </div>
      <div class="diff-main">
        {diff.truncated && (
          <div class="dim" style="margin: 8px 0">
            Große Hunks gekürzt — „ganzer Hunk“ antippen, um einen einzelnen vollständig zu laden.
          </div>
        )}
        {diff.commitsTruncated && (
          <div class="dim" style="margin: 8px 0">
            Mehr als 200 Commits seit {diff.baseRef} — nur die jüngsten werden gegliedert.
          </div>
        )}
        {commits.map((c) => (
          <section key={c.sha} class="diff-commit-section">
            <CommitHeading commit={c} />
            {groups(c.files, c.sha)}
          </section>
        ))}
        {commits.length > 0 && diff.files.length > 0 && (
          <div class="diff-section-heading">Nicht committete Änderungen</div>
        )}
        {groups(diff.files)}
      </div>
    </div>
  );
}
