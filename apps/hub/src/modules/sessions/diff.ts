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
/** AC-P2-1: Sessions mit extrem vielen Commits kappen wir hier — ältere
 * bleiben über `commitsTruncated` sichtbar benannt, nie still verschwunden. */
const MAX_COMMITS = 200;

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

/** AC-P2-1: ein Commit seit baseRef, ältester zuerst, mit seinem eigenen
 * per-File-Diff (`sha^..sha`) — die Diff-Ansicht zeigt so einen Abschnitt
 * pro Commit statt einen gemischten Klumpen. Commits ohne eigene Änderungen
 * (z. B. Merges) tauchen hier nicht auf: ein Abschnitt zeigt Änderungen. */
interface DiffCommit {
  sha: string;
  shortSha: string;
  author: string;
  /** ISO-8601, Autor-Datum wie im git log. */
  date: string;
  subject: string;
  files: SessionDiffFile[];
}

export interface SessionDiffResult {
  /** ADR-0057: bei „Projekt direkt“ — Pfade, die beim Start schon geändert waren (gehören nicht der Session),
   * und ob HEAD/Branch seither gewandert sind. Fehlt bei Worktree-Sessions. */
  baseline?: { dirtyAtStart: string[]; dirtyTruncated: boolean; headAtStart: string | null; branchAtStart: string | null };
  /** Seit AC-P2-1 ausschließlich der NICHT committete Rest seit HEAD
   * (inkl. untracked, BUG-0020) — der committete Teil liegt in `commits[]`.
   * Ohne Commits im Bereich ist das exakt die alte Form. */
  files: SessionDiffFile[];
  /** AC-P2-1: Commits seit baseRef, ältester zuerst. */
  commits: DiffCommit[];
  /** true, wenn mehr als MAX_COMMITS Commits existierten — dann fehlen
   * die ältesten, sichtbar benannt statt still gedroppt. */
  commitsTruncated?: boolean;
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

interface CommitMeta {
  sha: string;
  shortSha: string;
  author: string;
  date: string;
  subject: string;
}

/** `git log baseRef..HEAD` als Metadaten-Liste, ältester zuerst. Schlägt in
 * einem Repo ohne jeden Commit fehl — Aufrufer fängt das (hier: über den
 * gemeinsamen try/catch in getSessionDiff). */
async function commitsSince(projectPath: string, baseRef: string): Promise<CommitMeta[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", projectPath, "log", `${baseRef}..HEAD`, "--reverse", "--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s"],
    { timeout: 5000, maxBuffer: 1024 * 1024 },
  );
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, shortSha, author, date, ...subject] = line.split("\x1f");
      return { sha: sha!, shortSha: shortSha!, author: author!, date: date!, subject: subject.join("\x1f") };
    });
}

/** Git's leerer Baum (Konstante): der Baum, gegen den ein Wurzel-Commit diffet. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/**
 * Basis für `sha^..sha` (BUG-0202): ein Wurzel-Commit hat keine Eltern-Revision, `sha^`
 * ist dann ein Fatal — und ein einziger solcher Commit im Bereich ließ bisher den
 * gesamten Änderungsdiff ausfallen. Für ihn wird gegen den leeren Baum gediffelt.
 */
async function parentOrEmptyTree(projectPath: string, sha: string): Promise<string> {
  try {
    await execFileAsync("git", ["-C", projectPath, "rev-parse", "--verify", "--quiet", `${sha}^`], { timeout: 5000 });
    return `${sha}^`;
  } catch {
    return EMPTY_TREE;
  }
}

/** Per-Commit-Diff `sha^..sha` in derselben Struktur wie der Workdir-Teil.
 * Untracked-Handling ist hier bewusst unnötig: Committetes liegt per
 * Definition im Baum. */
async function commitFiles(projectPath: string, sha: string): Promise<{ files: SessionDiffFile[]; patch: string }> {
  const basis = await parentOrEmptyTree(projectPath, sha);
  const { stdout: numstat } = await execFileAsync("git", ["-C", projectPath, "diff", "--numstat", basis, sha], {
    timeout: 5000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const { stdout: patch } = await execFileAsync("git", ["-C", projectPath, "diff", basis, sha], {
    timeout: 5000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const blocks = splitByFileBlocks(patch);
  const files = parseNumstat(numstat).map((f, i) => ({ ...f, hunks: parseHunks(blocks[i] ?? "") }));
  return { files, patch };
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
  const untracked = await untrackedDiff(projectPath, pathArgs);
  return { numstat: numstat + untracked.numstat, patch: patch + untracked.patch };
}

/** Untracked files beyond this count are left out of the diff. */
const MAX_UNTRACKED_FILES = 200;

/** `git diff --no-index` exits 1 when the files differ — that is its
 * success case, with the diff on stdout. */
async function noIndexDiff(projectPath: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", projectPath, "diff", "--no-index", ...args], {
      timeout: 5000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    const failure = err as { code?: unknown; stdout?: unknown };
    if (failure.code === 1 && typeof failure.stdout === "string") return failure.stdout;
    throw err;
  }
}

/**
 * BUG-0020: `git diff <base>` ignores files nobody staged — exactly what an
 * agent leaves behind when it creates a file. Each untracked, not ignored
 * file is diffed against /dev/null and appended in the same numstat/patch
 * shape as the tracked diff (fixed a/ b/ prefixes, whatever the user's
 * diff.mnemonicPrefix says).
 */
async function untrackedDiff(projectPath: string, pathArgs: string[]): Promise<{ numstat: string; patch: string }> {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", projectPath, "ls-files", "--others", "--exclude-standard", "-z", ...pathArgs],
    { timeout: 5000, maxBuffer: 4 * 1024 * 1024 },
  );
  const files = stdout.split("\0").filter(Boolean).slice(0, MAX_UNTRACKED_FILES);
  let numstat = "";
  let patch = "";
  for (const file of files) {
    const stat = await noIndexDiff(projectPath, ["--numstat", "--", "/dev/null", file]);
    const [add = "0", del = "0"] = stat.split("\t");
    numstat += `${add}\t${del}\t${file}\n`;
    const body = await noIndexDiff(projectPath, ["--src-prefix=a/", "--dst-prefix=b/", "--", "/dev/null", file]);
    patch += body.replace(/^diff --git .*$/m, `diff --git a/${file} b/${file}`);
  }
  return { numstat, patch };
}

export async function getSessionDiff(projectPath: string, worktreeBaseSha?: string | null): Promise<SessionDiffResult> {
  // `diff HEAD` alone only shows unstaged changes — a file already
  // `git add`ed (but not committed) would silently disappear from the
  // report (real bug, caught by this module's own test against a real
  // repo). Diffing against `worktreeBaseSha` when the session is
  // isolated (T2.1) shows everything since the session's real base,
  // committed or not — that's what "what did this session change" means
  // once every session commits on its own branch. Seit AC-P2-1 ist der
  // committete Teil davon in `commits[]` gegliedert; `files` trägt nur
  // noch den uncommitteten Rest seit HEAD.
  const baseRef = worktreeBaseSha ?? "HEAD";
  try {
    const workdir = await realGitDiff(projectPath, "HEAD");
    const metas = baseRef === "HEAD" ? [] : await commitsSince(projectPath, baseRef);
    const commitsTruncated = metas.length > MAX_COMMITS;
    let commits: DiffCommit[] = [];
    const commitPatches: string[] = [];
    for (const meta of metas.slice(0, MAX_COMMITS)) {
      const { files, patch } = await commitFiles(projectPath, meta.sha);
      commitPatches.push(patch);
      if (files.length > 0) commits.push({ ...meta, files });
    }
    const statFiles = parseNumstat(workdir.numstat);
    if (statFiles.length === 0 && commits.length === 0) {
      return { files: [], commits: [], patch: "", truncated: false, baseRef, error: "keine Änderungen im Arbeitsverzeichnis" };
    }
    const perFileBlocks = splitByFileBlocks(workdir.patch);
    // K3 gilt für die ganze Antwort: Workdir- UND Commit-Abschnitte
    // kollabieren gemeinsam, sobald die Summe aller Patches über der
    // Schwelle liegt (AC-P2-2 misst die gesamte initiale Payload).
    const totalBytes =
      Buffer.byteLength(workdir.patch, "utf8") + commitPatches.reduce((sum, p) => sum + Buffer.byteLength(p, "utf8"), 0);
    const overK3 = totalBytes > K3_THRESHOLD_BYTES;
    const files: SessionDiffFile[] = statFiles.map((f, i) => {
      const raw = perFileBlocks[i];
      const hunks = raw ? parseHunks(raw) : [];
      return { ...f, hunks: overK3 ? collapseForK3(hunks) : hunks };
    });
    if (overK3) {
      commits = commits.map((c) => ({ ...c, files: c.files.map((f) => ({ ...f, hunks: collapseForK3(f.hunks) })) }));
    }
    // Legacy-Rohtext (liest keine PWA-Komponente seit T2.3): committete
    // Patches vor den uncommitteten, in chronologischer Reihenfolge —
    // inhaltlich äquivalent zu einem `git diff baseRef`, nur bereits
    // berechnet, statt einen dritten git-Aufruf zu machen.
    const fullPatch = commitPatches.join("") + workdir.patch;
    const truncatedPatch = totalBytes > MAX_PATCH_BYTES;
    // T2.9/AC-P2-2 real gap found while building the K3 gate test: `patch`
    // used to stay capped at MAX_PATCH_BYTES (200 KB) independently of
    // `overK3`'s 3-line hunk collapse — for a genuinely huge diff the
    // *response* could still land near 200 KB even though every hunk in
    // `files` was already collapsed, defeating AC-P2-2's "initial payload
    // ≤ 50 KB" entirely. Nothing in the PWA reads `.patch` since T2.3
    // moved rendering onto the structured `hunks` (verified: no
    // `apps/pwa/src/*.tsx` references `.patch`), so once hunks are
    // already collapsed there is nothing left for the raw text to usefully
    // carry — it's dropped instead of independently truncated.
    return {
      files,
      commits,
      ...(commitsTruncated ? { commitsTruncated } : {}),
      patch: overK3 ? "" : truncatedPatch ? fullPatch.slice(0, MAX_PATCH_BYTES) : fullPatch,
      truncated: truncatedPatch || overK3,
      baseRef,
    };
  } catch (err) {
    // Most common real case: projectPath isn't a git repo at all (dummy
    // sessions in tests, or a plain non-repo directory) — a named error,
    // not a thrown 500 or a dishonest empty-but-successful result.
    const message = err instanceof Error ? err.message : String(err);
    return { files: [], commits: [], patch: "", truncated: false, baseRef, error: `git diff fehlgeschlagen: ${message.slice(0, 200)}` };
  }
}

/**
 * T2.2 expand-on-tap: recomputes one file's hunks in full (never
 * collapsed), for the PWA to fetch after a K3-collapsed hunk is tapped.
 * Mit `commitSha` (AC-P2-1) wird der Hunk gegen DIESEN Commit geladen
 * (`sha^..sha`) — ein Kollaps im Commit-Abschnitt expandiert also gegen
 * den Commit, nicht gegen das Arbeitsverzeichnis.
 */
export async function getSessionFileHunks(
  projectPath: string,
  filePath: string,
  worktreeBaseSha?: string | null,
  commitSha?: string,
): Promise<DiffHunk[]> {
  if (commitSha) {
    const basis = await parentOrEmptyTree(projectPath, commitSha);
    const { stdout: patch } = await execFileAsync(
      "git",
      ["-C", projectPath, "diff", basis, commitSha, "--", filePath],
      { timeout: 5000, maxBuffer: 8 * 1024 * 1024 },
    );
    const [raw] = splitByFileBlocks(patch);
    return raw ? parseHunks(raw) : [];
  }
  const baseRef = worktreeBaseSha ?? "HEAD";
  const { patch } = await realGitDiff(projectPath, baseRef, filePath);
  const [raw] = splitByFileBlocks(patch);
  return raw ? parseHunks(raw) : [];
}
