import { describe, expect, it } from "vitest";
import type { GitGraphCommit } from "@ancientvoid/contracts";
import { layoutGitGraph } from "../../../src/features/git-graph/layout.ts";

function c(partial: Partial<GitGraphCommit> & Pick<GitGraphCommit, "sha" | "parents" | "subject">): GitGraphCommit {
  return {
    shortSha: partial.sha.slice(0, 7),
    author: "a",
    date: "2026-01-01T00:00:00Z",
    refs: [],
    files: [],
    ...partial,
  };
}

describe("layoutGitGraph", () => {
  it("weist Lanes zu und markiert Merges", () => {
    const commits = [
      c({ sha: "m1", parents: ["a1", "b1"], subject: "merge" }),
      c({ sha: "b1", parents: ["a0"], subject: "side" }),
      c({ sha: "a1", parents: ["a0"], subject: "main tip" }),
      c({ sha: "a0", parents: [], subject: "root" }),
    ];
    const { rows, laneCount } = layoutGitGraph(commits);
    expect(rows).toHaveLength(4);
    expect(laneCount).toBeGreaterThanOrEqual(2);
    expect(rows[0]!.merge).toBe(true);
    expect(rows[0]!.edges.length).toBe(2);
    expect(rows[3]!.merge).toBe(false);
  });
});
