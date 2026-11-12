import type { GitGraphCommit } from "@ancientvoid/contracts";

/** Eine Zeile im Graph: Commit + Lane + Verbindungspunkte für Eltern. */
export interface GitGraphRow {
  commit: GitGraphCommit;
  lane: number;
  /** Lanes, die in dieser Zeile weiterlaufen (ohne den Commit-Knoten). */
  active: number[];
  /** Eltern-Verbindungen: von dieser Lane zur Parent-Lane (nach unten). */
  edges: { fromLane: number; toLane: number; colorLane: number }[];
  /** true, wenn ≥2 Eltern (Merge-Punkt). */
  merge: boolean;
}

/**
 * Klassisches Git-Graph-Lane-Layout (neueste zuerst), angelehnt an übliche
 * Desktop-UIs: eine Spalte pro aktiver Linie, Merge/Fork sichtbar.
 */
export function layoutGitGraph(commits: readonly GitGraphCommit[]): { rows: GitGraphRow[]; laneCount: number } {
  const index = new Map(commits.map((c, i) => [c.sha, i]));
  const laneOf = new Map<string, number>();
  const rows: GitGraphRow[] = [];
  let nextLane = 0;

  const freeLane = (used: Set<number>): number => {
    for (let i = 0; i < nextLane; i++) if (!used.has(i)) return i;
    const n = nextLane++;
    return n;
  };

  // activeLanes[lane] = sha that owns the tip of that lane going downward
  let active: (string | null)[] = [];

  for (const commit of commits) {
    let lane = laneOf.get(commit.sha);
    if (lane === undefined) {
      // first appearance: place on a free lane (or reuse if a parent already reserved)
      const used = new Set(active.map((s, i) => (s ? i : -1)).filter((i) => i >= 0));
      lane = freeLane(used);
      laneOf.set(commit.sha, lane);
    }
    while (active.length <= lane) active.push(null);
    active[lane] = commit.sha;

    const edges: GitGraphRow["edges"] = [];
    const parents = commit.parents;
    parents.forEach((p, pi) => {
      let pLane = laneOf.get(p);
      if (pLane === undefined) {
        if (pi === 0) {
          pLane = lane;
        } else {
          const used = new Set(active.map((s, i) => (s ? i : -1)).filter((i) => i >= 0));
          used.add(lane);
          pLane = freeLane(used);
          while (active.length <= pLane) active.push(null);
        }
        laneOf.set(p, pLane);
      }
      edges.push({ fromLane: lane, toLane: pLane, colorLane: pLane });
      active[pLane] = p;
    });

    // First parent continues this lane; clear if no parents (root)
    if (parents.length === 0) {
      active[lane] = null;
    } else {
      active[lane] = parents[0]!;
      laneOf.set(parents[0]!, lane);
    }

    // Drop tips that are not among remaining commits (already shown as child)
    const activeLanes = active.map((s, i) => (s && index.has(s) && index.get(s)! > index.get(commit.sha)! ? i : -1)).filter((i) => i >= 0);

    rows.push({
      commit,
      lane,
      active: activeLanes,
      edges,
      merge: parents.length > 1,
    });
  }

  const laneCount = Math.max(1, nextLane, ...rows.map((r) => r.lane + 1));
  return { rows, laneCount };
}

export const GIT_LANE_COLORS = [
  "var(--accent)",
  "#9ece6a",
  "#e0af68",
  "#bb9af7",
  "#7dcfff",
  "#f7768e",
  "#73daca",
  "#c0caf5",
];
