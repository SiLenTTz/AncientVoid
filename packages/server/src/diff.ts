import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// T1.6-4/T1.6-5: shared by the Bericht tab's "Dateien geändert" count and
// the Diff tab's full patch view — one real git call, not two. Deliberately
// the simplest possible thing that could work: a raw `git diff` against the
// project directory's working tree, since no worktree isolation exists yet
// (that's P2 T2.1) — no hunk compression, no function anchors, no K3
// guarantee. A hard size cap keeps a huge diff from hanging the response;
// P2's real diff engine is what actually solves that properly.
const MAX_PATCH_BYTES = 200_000;

export interface SessionDiffFile {
  path: string;
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface SessionDiffResult {
  files: SessionDiffFile[];
  patch: string;
  truncated: boolean;
  /** Set when the project isn't a git repo (or has no changes) — a real,
   * named reason, never a silently empty result pretending nothing changed. */
  error?: string;
}

function parseNumstat(numstat: string): SessionDiffFile[] {
  const files: SessionDiffFile[] = [];
  for (const line of numstat.split("\n")) {
    if (!line.trim()) continue;
    const [add, del, ...pathParts] = line.split("\t");
    const path = pathParts.join("\t");
    const binary = add === "-" || del === "-";
    files.push({
      path,
      additions: binary ? 0 : Number(add),
      deletions: binary ? 0 : Number(del),
      binary,
    });
  }
  return files;
}

export async function getSessionDiff(projectPath: string): Promise<SessionDiffResult> {
  try {
    // `git diff` alone only shows unstaged changes — a file a session
    // already `git add`ed (but not committed) would silently disappear
    // from the report (real bug, caught by this module's own test against
    // a real repo). `diff HEAD` shows everything changed since the last
    // commit, staged or not — what "what did this session change" means.
    const { stdout: numstat } = await execFileAsync("git", ["-C", projectPath, "diff", "HEAD", "--numstat"], {
      timeout: 5000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const files = parseNumstat(numstat);
    if (files.length === 0) {
      return { files: [], patch: "", truncated: false, error: "keine Änderungen im Arbeitsverzeichnis" };
    }
    const { stdout: patch } = await execFileAsync("git", ["-C", projectPath, "diff", "HEAD"], {
      timeout: 5000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const truncated = Buffer.byteLength(patch, "utf8") > MAX_PATCH_BYTES;
    return {
      files,
      patch: truncated ? patch.slice(0, MAX_PATCH_BYTES) : patch,
      truncated,
    };
  } catch (err) {
    // Most common real case: projectPath isn't a git repo at all (dummy
    // sessions in tests, or a plain non-repo directory) — a named error,
    // not a thrown 500 or a dishonest empty-but-successful result.
    const message = err instanceof Error ? err.message : String(err);
    return { files: [], patch: "", truncated: false, error: `git diff fehlgeschlagen: ${message.slice(0, 200)}` };
  }
}
