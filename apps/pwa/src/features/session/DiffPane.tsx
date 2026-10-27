import { useMemo, useState } from "preact/hooks";
import { useApi } from "../../shared/api-context.ts";
import { type SessionDiffResult, type DiffHunk } from "../../shared/api.ts";
import { diffLineClass, isOneSided, pairHunkLines } from "./diff-lines.ts";

/**
 * T1.6-5 → T2.3 (EPIC-P2 §4): per-file hunk cards, replacing the raw
 * concatenated-patch view. Each hunk shows git's own real function-context
 * anchor (T2.2) and, once collapsed under K3, a tap-to-expand button that
 * fetches the full hunk via GET /api/sessions/:id/diff/hunk.
 */
export function HunkCard({
  sessionId,
  path,
  hunk,
  index,
}: {
  sessionId: string;
  path: string;
  hunk: DiffHunk;
  index: number;
}) {
  const api = useApi();
  const [expanded, setExpanded] = useState<DiffHunk | null>(null);
  const [loading, setLoading] = useState(false);
  const active = expanded ?? hunk;
  const rows = useMemo(() => pairHunkLines(active.body), [active.body]);
  const oneSided = useMemo(() => isOneSided(rows), [rows]);

  const onExpand = async () => {
    setLoading(true);
    try {
      const res = await api.sessionDiffHunk(sessionId, path);
      const full = res.hunks[index];
      if (full) setExpanded(full);
    } catch {
      // stays collapsed — a failed expand is a no-op, not a crash
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class={`hunk-card${oneSided ? " one-sided" : ""}`}>
      <div class="hunk-card-header mono">
        <span class="hunk-range">
          -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines}
        </span>
        <span class="hunk-fn">{active.functionContext ?? "—"}</span>
        {active.collapsed && (
          <button class={loading ? "hunk-expand-btn busy" : "hunk-expand-btn"} aria-busy={loading} onClick={onExpand} disabled={loading}>
            {loading ? "lädt…" : "ganzer Hunk"}
          </button>
        )}
      </div>
      <div class="hunk-body-unified mono">
        {active.body.split("\n").map((line, i) => (
          <div key={i} class={diffLineClass(line)}>
            {line}
          </div>
        ))}
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

export function DiffPane({ diff, sessionId }: { diff: SessionDiffResult | null; sessionId: string }) {
  if (diff === null) return <div class="empty">lädt …</div>;
  if (diff.error) return <div class="empty">{diff.error}</div>;
  // EPIC-P20 T20.1: from 1280 px the file list sits beside the code (CSS), a click jumps to
  // the file. The phone keeps the stacked list; the rows only gain a jump there.
  const jump = (index: number) => {
    const root = document.querySelector(".tail-scroll");
    root?.querySelector(`[id="${fileAnchor(index)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <div class="diff-pane">
      <div class="diff-files">
        {diff.files.map((f, i) => (
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
              <span>
                <span class="diff-add-count">+{f.additions}</span> <span class="diff-del-count">-{f.deletions}</span>
              </span>
            )}
          </div>
        ))}
      </div>
      <div class="diff-main">
        {diff.truncated && (
          <div class="dim" style="margin: 8px 0">
            Große Hunks gekürzt — „ganzer Hunk" antippen, um einen einzelnen vollständig zu laden.
          </div>
        )}
        {diff.files.map((f, i) =>
          f.binary || f.hunks.length === 0 ? null : (
            <div key={f.path} class="diff-file-group" id={fileAnchor(i)}>
              <div class="diff-file-heading mono">{f.path}</div>
              {f.hunks.map((h, j) => (
                <HunkCard key={`${f.path}:${j}`} sessionId={sessionId} path={f.path} hunk={h} index={j} />
              ))}
            </div>
          ),
        )}
      </div>
    </div>
  );
}
