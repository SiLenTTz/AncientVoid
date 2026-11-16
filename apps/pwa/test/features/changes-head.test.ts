import { describe, expect, it } from "vitest";
import type { SessionDiffResult } from "../../src/shared/api.ts";
import { changeSummary } from "../../src/features/session/ChangesHead.tsx";

const diff = (over: Partial<SessionDiffResult>): SessionDiffResult =>
  ({ files: [], commits: [], patch: "", truncated: false, baseRef: "HEAD", ...over }) as SessionDiffResult;

describe("changeSummary (EPIC-P43 T43.5)", () => {
  it("zählt jeden Pfad einmal, über Commits und uncommitteten Rest", () => {
    const sum = changeSummary(
      diff({
        commits: [{ sha: "a", subject: "x", files: [{ path: "a.ts", additions: 3, deletions: 1 }] }] as SessionDiffResult["commits"],
        files: [
          { path: "a.ts", additions: 2, deletions: 0 },
          { path: "b.ts", additions: 1, deletions: 4 },
        ] as SessionDiffResult["files"],
      }),
    );
    expect(sum).toEqual({ files: 2, additions: 6, deletions: 5 });
  });

  it("ein leerer Diff ist ein Befund (0 Dateien), kein Fehler — Kleinkram-Regel 2", () => {
    expect(changeSummary(diff({ error: "keine Änderungen im Arbeitsverzeichnis" }))).toEqual({ files: 0, additions: 0, deletions: 0 });
  });

  it("ohne Diff oder bei echtem Fehler gibt es keine Zahl", () => {
    expect(changeSummary(null)).toBeNull();
    expect(changeSummary(diff({ error: "git diff fehlgeschlagen: kaputt" }))).toBeNull();
  });
});
