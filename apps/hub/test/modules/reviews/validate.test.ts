import { describe, expect, it } from "vitest";
import type { ReviewNote } from "@ancientvoid/contracts";
import type { DiffHunk, SessionDiffResult } from "../../../src/modules/sessions/diff.ts";
import { hunkSideLines, validateNote } from "../../../src/modules/reviews/validate.ts";

/** EPIC-P36 T36.2: Anker-Wiedervorlage — rein, ohne git. */

const HEAD = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_HEAD = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const SHA_C1 = "1111111111111111111111111111111111111111";
const SHA_C2 = "2222222222222222222222222222222222222222";

function hunk(body: string, over: Partial<DiffHunk> = {}): DiffHunk {
  return {
    header: "@@ -1,3 +1,3 @@",
    functionContext: null,
    oldStart: 1,
    oldLines: 3,
    newStart: 1,
    newLines: 3,
    body,
    collapsed: false,
    ...over,
  };
}

function diff(over: Partial<SessionDiffResult> = {}): SessionDiffResult {
  return {
    files: [
      { path: "src/app.ts", additions: 1, deletions: 1, binary: false, hunks: [hunk(" old line\n-new line\n+new line changed")] },
    ],
    commits: [],
    patch: "",
    truncated: false,
    baseRef: "base000000000000000000000000000000000000000",
    ...over,
  };
}

function note(over: Partial<ReviewNote> = {}): ReviewNote {
  return {
    id: "n1",
    sessionId: "s1",
    basis: { baseRef: "base000000000000000000000000000000000000000", headSha: HEAD, scope: { kind: "uncommitted" } },
    anchor: { path: "src/app.ts", side: "new", startLine: 2, endLine: 2, excerpt: "new line changed" },
    text: "Notiz",
    status: "draft",
    createdAt: "2026-11-08T00:00:00.000Z",
    updatedAt: "2026-11-08T00:00:00.000Z",
    sentAt: null,
    operationId: null,
    sendDetail: null,
    ...over,
  };
}

describe("validateNote", () => {
  it("uncommitteter Rest mit passendem Ausschnitt bleibt gültig", () => {
    expect(validateNote(note(), diff(), HEAD)).toEqual({ anchorState: "valid", staleReason: null });
  });

  it("geänderte Diff-Basis markiert stale mit benanntem Grund", () => {
    const verdict = validateNote(note(), diff({ baseRef: OTHER_HEAD }), HEAD);
    expect(verdict.anchorState).toBe("stale");
    expect(verdict.staleReason).toContain("Diff-Basis hat sich geändert");
  });

  it("neuer HEAD seit der Notiz → stale (uncommitteten Rest neu ansehen)", () => {
    const verdict = validateNote(note(), diff(), OTHER_HEAD);
    expect(verdict.anchorState).toBe("stale");
    expect(verdict.staleReason).toContain("HEAD hat sich geändert");
  });

  it("HEAD nicht vergleichbar → unclear, nie geraten", () => {
    const verdict = validateNote(note(), diff(), null);
    expect(verdict.anchorState).toBe("unclear");
  });

  it("Datei weg (umbenannt/gelöscht/committet) → stale mit Grund", () => {
    const verdict = validateNote(note(), diff({ files: [] }), HEAD);
    expect(verdict.anchorState).toBe("stale");
    expect(verdict.staleReason).toContain("nicht mehr im uncommitteten Diff");
  });

  it("binär gewordene Datei → stale", () => {
    const verdict = validateNote(note(), diff({ files: [{ path: "src/app.ts", additions: 0, deletions: 0, binary: true, hunks: [] }] }), HEAD);
    expect(verdict.anchorState).toBe("stale");
    expect(verdict.staleReason).toContain("binär");
  });

  it("geänderter Ankerinhalt → stale (kein automatisches Verschieben)", () => {
    const changed = diff({ files: [{ path: "src/app.ts", additions: 1, deletions: 1, binary: false, hunks: [hunk(" old line\n-new line\n+completely different now")] }] });
    const verdict = validateNote(note(), changed, HEAD);
    expect(verdict.anchorState).toBe("stale");
    expect(verdict.staleReason).toContain("nicht mehr überein");
  });

  it("gewandertes Ankerumfeld → stale mit Hinweis auf Neuverankerung", () => {
    // Der Ankerbereich (neue Zeile 2) existiert nicht mehr — derselbe Inhalt
    // lebt jetzt bei Zeile 100: verschieben ist nicht Aufgabe des Hubs.
    const moved = diff({
      files: [
        {
          path: "src/app.ts",
          additions: 1,
          deletions: 1,
          binary: false,
          hunks: [hunk("+new line changed", { header: "@@ -50,1 +100,1 @@", oldStart: 50, oldLines: 1, newStart: 100, newLines: 1 })],
        },
      ],
    });
    const verdict = validateNote(note(), moved, HEAD);
    expect(verdict.anchorState).toBe("stale");
    expect(verdict.staleReason).toContain("an anderer Stelle");
  });

  it("K3-gekürzte Hunks → unclear (ehrlich unprüfbar)", () => {
    const collapsed = diff({ files: [{ path: "src/app.ts", additions: 1, deletions: 1, binary: false, hunks: [hunk(" old line\n-new line", { collapsed: true })] }] });
    const verdict = validateNote(note(), collapsed, HEAD);
    expect(verdict.anchorState).toBe("unclear");
  });

  it("Commit-Scope bleibt gültig, solange Commit und Datei im Abschnitt liegen", () => {
    const scoped = note({ basis: { baseRef: "base000000000000000000000000000000000000000", headSha: null, scope: { kind: "commit", sha: SHA_C1 } } });
    const withCommits = diff({
      commits: [{ sha: SHA_C1, shortSha: "11111111", author: "a", date: "2026-11-08T00:00:00Z", subject: "c1", files: diff().files }],
    });
    expect(validateNote(scoped, withCommits, OTHER_HEAD)).toEqual({ anchorState: "valid", staleReason: null });
  });

  it("Commit nicht mehr im Diff-Bereich → stale", () => {
    const scoped = note({ basis: { baseRef: "base000000000000000000000000000000000000000", headSha: null, scope: { kind: "commit", sha: SHA_C2 } } });
    const withCommits = diff({
      commits: [{ sha: SHA_C1, shortSha: "11111111", author: "a", date: "2026-11-08T00:00:00Z", subject: "c1", files: diff().files }],
    });
    const verdict = validateNote(scoped, withCommits, HEAD);
    expect(verdict.anchorState).toBe("stale");
    expect(verdict.staleReason).toContain("nicht mehr im Diff-Bereich");
  });

  it("gleiche Datei/Zeile in zwei Commit-Abschnitten: beide gültig, keine Kollision (AC-P36-1)", () => {
    const files = diff().files;
    const withCommits = diff({
      commits: [
        { sha: SHA_C1, shortSha: "11111111", author: "a", date: "2026-11-08T00:00:00Z", subject: "c1", files },
        { sha: SHA_C2, shortSha: "22222222", author: "a", date: "2026-11-08T00:00:01Z", subject: "c2", files },
      ],
    });
    const n1 = note({ id: "a", basis: { baseRef: withCommits.baseRef, headSha: null, scope: { kind: "commit", sha: SHA_C1 } } });
    const n2 = note({ id: "b", basis: { baseRef: withCommits.baseRef, headSha: null, scope: { kind: "commit", sha: SHA_C2 } } });
    expect(validateNote(n1, withCommits, HEAD).anchorState).toBe("valid");
    expect(validateNote(n2, withCommits, HEAD).anchorState).toBe("valid");
  });
});

describe("hunkSideLines", () => {
  it("nummeriert Kontext/Add/Del korrekt beidseitig", () => {
    const lines = hunkSideLines(hunk(" ctx\n-del\n+add", { oldStart: 10, oldLines: 2, newStart: 20, newLines: 2 }));
    expect(lines).toEqual([
      { oldLine: 10, newLine: 20, text: "ctx" },
      { oldLine: 11, newLine: null, text: "del" },
      { oldLine: null, newLine: 21, text: "add" },
    ]);
  });

  it("überspringt „\\ No newline“-Marker", () => {
    const lines = hunkSideLines(hunk("+add\n\\ No newline at end of file"));
    expect(lines).toHaveLength(1);
  });
});
