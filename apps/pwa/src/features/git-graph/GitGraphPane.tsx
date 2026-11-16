import { useEffect, useMemo, useState } from "preact/hooks";
import type { GitGraphReport } from "@ancientvoid/contracts";
import { hostApi } from "../../shared/api.ts";
import { openLayer } from "../../shared/layers.ts";
import { GIT_LANE_COLORS, layoutGitGraph } from "./layout.ts";

const ROW_H = 44;
const LANE_W = 14;
const DOT_R = 5;

/**
 * ADR-0071: farbige Branch-Linien, Merge-/Fork-Punkte; Datei-Klick → Projekt-Explorer.
 */
export function GitGraphPane({
  target,
  hostId = null,
  sessionId,
}: {
  target: string;
  hostId?: string | null;
  /** Projekt-Target (globale Git-Struktur-Ebene): null — Dateiklicks haben dann keinen Session-Explorer. */
  sessionId: string | null;
}) {
  const api = useMemo(() => hostApi(hostId), [hostId]);
  const [report, setReport] = useState<GitGraphReport | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setReport(null);
    setError("");
    api
      .gitGraph(target)
      .then((r) => {
        if (alive) setReport(r);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [api, target]);

  const { rows, laneCount } = useMemo(() => (report ? layoutGitGraph(report.commits) : { rows: [], laneCount: 1 }), [report]);
  const branchColor = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of report?.branches ?? []) m.set(b.sha, b.colorIndex);
    return m;
  }, [report]);

  const openInExplorer = (path: string) => {
    // Projekt-Target: ohne Session gibt es keinen Worktree-Explorer-Sprung.
    if (!sessionId) return;
    openLayer("files");
    window.dispatchEvent(
      new CustomEvent("ancientvoid:files-open-path", {
        detail: { sessionId, path, hostId: hostId ?? null },
      }),
    );
  };

  const graphW = Math.max(48, laneCount * LANE_W + 16);

  return (
    <div class="git-graph-pane" data-testid="git-graph-pane">
      {report?.truncated && (
        <div class="graph-banner">
          Verlauf gekappt: neueste {report.maxCommits} Commits — ältere fehlen sichtbar.
        </div>
      )}
      {report?.branches && report.branches.length > 0 && (
        <div class="git-graph-branches" data-testid="git-graph-branches">
          {report.branches.slice(0, 24).map((b) => (
            <span class="git-graph-branch" key={b.name} style={{ "--lane": GIT_LANE_COLORS[b.colorIndex % GIT_LANE_COLORS.length] } as never}>
              {b.name}
            </span>
          ))}
        </div>
      )}
      {error && <div class="files-error">Git-Graph nicht ladbar: {error}</div>}
      {report?.error && <div class="files-error">{report.error}</div>}
      {!report && !error && <div class="empty">Lade Git-Graph …</div>}
      {report && !report.error && (
        <ul class="git-graph-list" role="list">
          {rows.map((row, ri) => {
            const colorIdx = branchColor.get(row.commit.sha) ?? row.lane % GIT_LANE_COLORS.length;
            const color = GIT_LANE_COLORS[colorIdx % GIT_LANE_COLORS.length];
            const open = expanded === row.commit.sha;
            const svgH = ROW_H;
            return (
              <li key={row.commit.sha} class={`git-graph-row${row.merge ? " merge" : ""}`} data-sha={row.commit.sha}>
                <svg class="git-graph-rails" width={graphW} height={svgH} aria-hidden="true">
                  {row.active.map((lane) => (
                    <line
                      key={`a${lane}`}
                      x1={8 + lane * LANE_W}
                      y1={0}
                      x2={8 + lane * LANE_W}
                      y2={svgH}
                      stroke={GIT_LANE_COLORS[lane % GIT_LANE_COLORS.length]}
                      stroke-width="2"
                    />
                  ))}
                  {row.edges.map((e, ei) => {
                    const x1 = 8 + e.fromLane * LANE_W;
                    const x2 = 8 + e.toLane * LANE_W;
                    const y1 = svgH / 2;
                    const y2 = svgH;
                    const c = GIT_LANE_COLORS[e.colorLane % GIT_LANE_COLORS.length];
                    if (x1 === x2) {
                      return <line key={ei} x1={x1} y1={y1} x2={x2} y2={y2} stroke={c} stroke-width="2" />;
                    }
                    return (
                      <path
                        key={ei}
                        d={`M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`}
                        fill="none"
                        stroke={c}
                        stroke-width="2"
                      />
                    );
                  })}
                  {/* continuing vertical above for this lane */}
                  {ri > 0 && (
                    <line
                      x1={8 + row.lane * LANE_W}
                      y1={0}
                      x2={8 + row.lane * LANE_W}
                      y2={svgH / 2}
                      stroke={color}
                      stroke-width="2"
                    />
                  )}
                  <circle
                    cx={8 + row.lane * LANE_W}
                    cy={svgH / 2}
                    r={row.merge ? DOT_R + 1.5 : DOT_R}
                    fill={color}
                    stroke={row.merge ? "var(--fg)" : "transparent"}
                    stroke-width={row.merge ? 2 : 0}
                  />
                </svg>
                <div class="git-graph-body">
                  <button type="button" class="git-graph-commit" onClick={() => setExpanded(open ? null : row.commit.sha)}>
                    <code class="git-graph-sha">{row.commit.shortSha}</code>
                    <span class="git-graph-subject">{row.commit.subject}</span>
                    {row.commit.refs.length > 0 && (
                      <span class="git-graph-refs">
                        {row.commit.refs.map((r) => (
                          <span class="git-graph-ref" key={r}>{r}</span>
                        ))}
                      </span>
                    )}
                    <span class="dim git-graph-meta">{row.commit.author} · {new Date(row.commit.date).toLocaleString("de-DE")}</span>
                  </button>
                  {open && (
                    <ul class="git-graph-files" data-testid="git-graph-files">
                      {row.commit.files.map((f) => (
                        <li key={f.path}>
                          <button type="button" class="link-btn" onClick={() => openInExplorer(f.path)}>
                            <span class="git-graph-status">{f.status}</span> {f.path}
                          </button>
                        </li>
                      ))}
                      {row.commit.files.length === 0 && <li class="dim">keine Dateiänderungen</li>}
                      {row.commit.filesTruncated && <li class="dim">… weitere Dateien gekappt</li>}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
