import { useMemo, useState } from "preact/hooks";
import { useApi } from "../../shared/api-context.ts";
import { type SessionDiffResult, type DiffHunk } from "../../shared/api.ts";

/**
 * T1.6-5 → T2.3 (EPIC-P2 §4): per-file hunk cards, replacing the raw
 * concatenated-patch view. Each hunk shows git's own real function-context
 * anchor (T2.2) and, once collapsed under K3, a tap-to-expand button that
 * fetches the full hunk via GET /api/sessions/:id/diff/hunk.
 */
export function diffLineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "diff-line-file";
  if (line.startsWith("+")) return "diff-line-add";
  if (line.startsWith("-")) return "diff-line-del";
  if (line.startsWith("@@")) return "diff-line-hunk";
  if (line.startsWith("diff --git")) return "diff-line-header";
  return "diff-line-ctx";
}

export interface SplitCell {
  type: "ctx" | "add" | "del" | "empty";
  text: string;
}

export interface SplitRow {
  left: SplitCell;
  right: SplitCell;
}

/**
 * Unified hunk body → side-by-side rows (T2.3 "Querformat side-by-side").
 * Classic run-pairing: consecutive `-` lines are paired against the
 * consecutive `+` lines that follow them, index by index, empty cells
 * filling whichever side ran out first; a context line flushes any
 * pending run and appears on both sides unchanged.
 */
export function pairHunkLines(body: string): SplitRow[] {
  const rows: SplitRow[] = [];
  let delBuf: string[] = [];
  let addBuf: string[] = [];
  const flush = () => {
    const n = Math.max(delBuf.length, addBuf.length);
    for (let i = 0; i < n; i++) {
      rows.push({
        left: i < delBuf.length ? { type: "del", text: delBuf[i]! } : { type: "empty", text: "" },
        right: i < addBuf.length ? { type: "add", text: addBuf[i]! } : { type: "empty", text: "" },
      });
    }
    delBuf = [];
    addBuf = [];
  };
  for (const line of body.split("\n")) {
    if (line.startsWith("-")) delBuf.push(line.slice(1));
    else if (line.startsWith("+")) addBuf.push(line.slice(1));
    else if (line.startsWith("\\")) continue; // "\ No newline at end of file"
    else {
      flush();
      const text = line.startsWith(" ") ? line.slice(1) : line;
      rows.push({ left: { type: "ctx", text }, right: { type: "ctx", text } });
    }
  }
  flush();
  return rows;
}

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
    <div class="hunk-card">
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

export function DiffPane({ diff, sessionId }: { diff: SessionDiffResult | null; sessionId: string }) {
  if (diff === null) return <div class="empty">lädt …</div>;
  if (diff.error) return <div class="empty">{diff.error}</div>;
  return (
    <div>
      <div class="diff-files">
        {diff.files.map((f) => (
          <div key={f.path} class="diff-file-row">
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
      {diff.truncated && (
        <div class="dim" style="margin: 8px 0">
          Große Hunks gekürzt — „ganzer Hunk" antippen, um einen einzelnen vollständig zu laden.
        </div>
      )}
      {diff.files.map((f) =>
        f.binary || f.hunks.length === 0 ? null : (
          <div key={f.path} class="diff-file-group">
            <div class="diff-file-heading mono">{f.path}</div>
            {f.hunks.map((h, i) => (
              <HunkCard key={`${f.path}:${i}`} sessionId={sessionId} path={f.path} hunk={h} index={i} />
            ))}
          </div>
        ),
      )}
    </div>
  );
}
