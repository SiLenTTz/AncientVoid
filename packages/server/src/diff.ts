import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// T1.6-4/T1.6-5 → T2.2 (EPIC-P2): shared by the Bericht tab's "Dateien
// geändert" count and the Diff tab's full patch view — one real git call,
// not two.
//
// T2.2 real upgrade over the T1.6 stopgap:
//  - diffs against the session's real `base_sha` (T2.1's worktree base)
//    when one exists, not just "HEAD of whatever's currently checked out"
//    — the whole point of worktree isolation is a stable diff base that
//    doesn't move under the session.
//  - structured per-file hunks with git's own real function-context
//    heuristic (the text git itself appends after the second `@@` on a
//    hunk header, e.g. `@@ -12,3 +12,4 @@ function foo() {`) — reused
//    as the "Funktions-Anker", not a hand-rolled ctags/regex parser
//    invented for this task. It is genuinely absent for some hunks/
//    languages (git has no built-in pattern for every language, and the
//    very first hunk of a brand-new file has no preceding context) —
//    `functionContext: null` in that case, never guessed.
//  - K3: payload over 50 KB collapses each hunk's body to a short preview
//    (header + function anchor stay), with `collapsed: true` — the PWA's
//    expand-on-tap re-fetches that one hunk in full via getSessionHunk().
const K3_THRESHOLD_BYTES = 50_000;
const HUNK_PREVIEW_LINES = 3;
const MAX_PATCH_BYTES = 200_000;

export interface DiffHunk {
  header: string;
  functionContext: string | null;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  body: string;
  /** true when `body` is a preview, not the full hunk (K3). */
  collapsed: boolean;
}

export interface SessionDiffFile {
  path: string;
  additions: number;
  deletions: number;
  binary: boolean;
  hunks: DiffHunk[];
}

export interface SessionDiffResult {
  files: SessionDiffFile[];
  patch: string;
  /** true if either the raw patch text was capped (pre-T2.2 behavior) or
   * any hunk was collapsed under K3 — "not everything is in this payload". */
  truncated: boolean;
  /** The ref this diff was computed against — the session's real
   * base_sha (T2.1) when the session is worktree-isolated, else the
   * literal string "HEAD" (pre-P2 fallback, still real git, just not
   * pinned to a stable base). */
  baseRef: string;
  /** Set when the project isn't a git repo (or has no changes) — a real,
   * named reason, never a silently empty result pretending nothing changed. */
  error?: string;
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

/**
 * Splits one file's raw `git diff` body into structured hunks.
 *
 * Real bug found by T2.9's own K3 payload-size gate test: an earlier
 * version of this function accumulated each hunk's lines in a working
 * `bodyLines: string[]` field on the same object that got pushed into the
 * result (`{ ...current, body: current.bodyLines.join("\n") }`) — the
 * spread carried `bodyLines` along for the ride, an internal accumulator
 * silently surviving into every returned `DiffHunk`. `collapseForK3()`
 * only ever overwrote `body`/`collapsed`, never touching this stray
 * field, so a "collapsed" hunk's `body` looked correctly tiny to any code
 * checking that field directly (every test did, until now) while
 * `JSON.stringify()` — what actually crosses the wire — still serialized
 * the full uncollapsed `bodyLines` array underneath it. K3's whole
 * point (bounding the real response size) was silently defeated for
 * every large diff. Fixed by building each hunk as its own explicit
 * object, with the accumulator kept in a separate local array that never
 * touches the returned shape.
 */
function parseHunks(fileDiff: string): DiffHunk[] {
  const lines = fileDiff.split("\n");
  const hunks: DiffHunk[] = [];
  let currentMeta: Omit<DiffHunk, "body"> | null = null;
  let currentLines: string[] = [];
  const flush = () => {
    if (currentMeta) hunks.push({ ...currentMeta, body: currentLines.join("\n") });
  };
  for (const line of lines) {
    const m = HUNK_HEADER_RE.exec(line);
    if (m) {
      flush();
      const [, oldStart, oldLines, newStart, newLines, ctx] = m;
      currentMeta = {
        header: line,
        functionContext: ctx && ctx.trim().length > 0 ? ctx.trim() : null,
        oldStart: Number(oldStart),
        oldLines: oldLines !== undefined ? Number(oldLines) : 1,
        newStart: Number(newStart),
        newLines: newLines !== undefined ? Number(newLines) : 1,
        collapsed: false,
      };
      currentLines = [];
    } else if (currentMeta) {
      currentLines.push(line);
    }
  }
  flush();
  return hunks;
}

/**
 * Splits a full `git diff` patch into per-file raw chunks, in file order.
 * Deliberately doesn't parse the path back out of the `diff --git <a> <b>`
 * header line — this machine's git config uses non-default diff prefixes
 * (`c/`/`w/` instead of `a/`/`b/`, real finding while testing this against
 * this repo's own git config), so any prefix-stripping regex is fragile.
 * `git diff` emits file blocks in the same order for identical arguments
 * whether asked for `--numstat` or the full patch, so the caller zips
 * these blocks positionally against numstat's (authoritative) path list
 * instead.
 */
function splitByFileBlocks(patch: string): string[] {
  return patch.split(/^diff --git .*$/m).slice(1);
}

function collapseForK3(hunks: DiffHunk[]): DiffHunk[] {
  return hunks.map((h) => {
    const bodyLines = h.body.split("\n");
    if (bodyLines.length <= HUNK_PREVIEW_LINES) return h;
    return {
      ...h,
      body: bodyLines.slice(0, HUNK_PREVIEW_LINES).join("\n"),
      collapsed: true,
    };
  });
}

function parseNumstat(numstat: string): { path: string; additions: number; deletions: number; binary: boolean }[] {
  const files: { path: string; additions: number; deletions: number; binary: boolean }[] = [];
  for (const line of numstat.split("\n")) {
    if (!line.trim()) continue;
    const [add, del, ...pathParts] = line.split("\t");
    const path = pathParts.join("\t");
    const binary = add === "-" || del === "-";
    files.push({ path, additions: binary ? 0 : Number(add), deletions: binary ? 0 : Number(del), binary });
  }
  return files;
}

async function realGitDiff(
  projectPath: string,
  baseRef: string,
  pathFilter?: string,
): Promise<{ numstat: string; patch: string }> {
  const pathArgs = pathFilter ? ["--", pathFilter] : [];
  const { stdout: numstat } = await execFileAsync(
    "git",
    ["-C", projectPath, "diff", baseRef, "--numstat", ...pathArgs],
    { timeout: 5000, maxBuffer: 4 * 1024 * 1024 },
  );
  const { stdout: patch } = await execFileAsync("git", ["-C", projectPath, "diff", baseRef, ...pathArgs], {
    timeout: 5000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return { numstat, patch };
}

export async function getSessionDiff(projectPath: string, worktreeBaseSha?: string | null): Promise<SessionDiffResult> {
  // `diff HEAD` alone only shows unstaged changes — a file already
  // `git add`ed (but not committed) would silently disappear from the
  // report (real bug, caught by this module's own test against a real
  // repo). Diffing against `worktreeBaseSha` when the session is
  // isolated (T2.1) shows everything since the session's real base,
  // committed or not — that's what "what did this session change" means
  // once every session commits on its own branch.
  const baseRef = worktreeBaseSha ?? "HEAD";
  try {
    const { numstat, patch } = await realGitDiff(projectPath, baseRef);
    const statFiles = parseNumstat(numstat);
    if (statFiles.length === 0) {
      return { files: [], patch: "", truncated: false, baseRef, error: "keine Änderungen im Arbeitsverzeichnis" };
    }
    const perFileBlocks = splitByFileBlocks(patch);
    const totalBytes = Buffer.byteLength(patch, "utf8");
    const overK3 = totalBytes > K3_THRESHOLD_BYTES;
    const files: SessionDiffFile[] = statFiles.map((f, i) => {
      const raw = perFileBlocks[i];
      const hunks = raw ? parseHunks(raw) : [];
      return { ...f, hunks: overK3 ? collapseForK3(hunks) : hunks };
    });
    const truncatedPatch = totalBytes > MAX_PATCH_BYTES;
    // T2.9/AC-P2-2 real gap found while building the K3 gate test: `patch`
    // used to stay capped at MAX_PATCH_BYTES (200 KB) independently of
    // `overK3`'s 3-line hunk collapse — for a genuinely huge diff the
    // *response* could still land near 200 KB even though every hunk in
    // `files` was already collapsed, defeating AC-P2-2's "initial payload
    // ≤ 50 KB" entirely. Nothing in the PWA reads `.patch` since T2.3
    // moved rendering onto the structured `hunks` (verified: no
    // `packages/pwa/src/*.tsx` references `.patch`), so once hunks are
    // already collapsed there is nothing left for the raw text to usefully
    // carry — it's dropped instead of independently truncated.
    return {
      files,
      patch: overK3 ? "" : truncatedPatch ? patch.slice(0, MAX_PATCH_BYTES) : patch,
      truncated: truncatedPatch || overK3,
      baseRef,
    };
  } catch (err) {
    // Most common real case: projectPath isn't a git repo at all (dummy
    // sessions in tests, or a plain non-repo directory) — a named error,
    // not a thrown 500 or a dishonest empty-but-successful result.
    const message = err instanceof Error ? err.message : String(err);
    return { files: [], patch: "", truncated: false, baseRef, error: `git diff fehlgeschlagen: ${message.slice(0, 200)}` };
  }
}

/**
 * T2.2 expand-on-tap: recomputes one file's hunks in full (never
 * collapsed), for the PWA to fetch after a K3-collapsed hunk is tapped.
 */
export async function getSessionFileHunks(
  projectPath: string,
  filePath: string,
  worktreeBaseSha?: string | null,
): Promise<DiffHunk[]> {
  const baseRef = worktreeBaseSha ?? "HEAD";
  const { patch } = await realGitDiff(projectPath, baseRef, filePath);
  const [raw] = splitByFileBlocks(patch);
  return raw ? parseHunks(raw) : [];
}
