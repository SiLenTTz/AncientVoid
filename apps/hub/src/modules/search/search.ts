import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { realpath, readFile, readdir, stat, open } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

/**
 * T3.8 (EPIC-P3 §3 "Sprachsuche") — Projekt-Index-Service.
 *
 * Real, verified ground truth (2026-09-18, this machine): `qmd` (npm
 * package `@tobilu/qmd`, real local hybrid search — BM25 + vector
 * similarity via a cached local GGUF embedding model, `embeddinggemma-
 * 300M-Q8_0.gguf`, no cloud call) is already installed and working here.
 * This module shells out to the real `qmd` CLI exactly like an adapter
 * shells out to `claude`/`codex`/`opencode` — never reimplements a vector
 * store or an embedding pipeline.
 *
 * **Scope, stated honestly:** this version of `qmd` only ever indexes
 * `**\/*.md` files (see `DEFAULT_PATTERN`'s doc comment below for the
 * real, confirmed reason) — this is markdown-documentation search
 * (epics, ADRs, README, docs/), not source-code search, regardless of
 * how EPIC-P3 §3's "Sprachsuche" design notes originally framed it.
 *
 * Real measured latencies (see docs/messlauf/2026-09-18-search-latency.md,
 * against this repo, 5 real markdown files):
 *   - `qmd search` (BM25 only, no LLM): ~0.13s
 *   - `qmd query` with an explicit `lex:`+`vec:` typed query document
 *     (hybrid, skips the default auto-expansion/hyde/rerank pipeline):
 *     ~3.1s — this is the default mode below.
 *   - `qmd query <text>` (default auto-expand + rerank): 17-30s+ — too
 *     slow for an interactive mobile search, not used here.
 *
 * Real, load-bearing limitation, found while building this (not guessed):
 * `qmd update` — the only command that rescans a collection's files for
 * new/changed/removed entries — verified live to touch EVERY collection
 * in the user's qmd index, not just the one named via `-c`/`--collection`
 * (that flag is documented as a *search-result* filter, not an `update`
 * scope). Calling it from the hub would silently re-scan a user's
 * unrelated personal qmd collections (e.g. a private notes vault) on
 * every AncientVoid search — an unacceptable side effect. So `ensureIndexed()`
 * only ever calls `collection add` ONCE (when the collection doesn't
 * exist yet) and `embed` (verified scoped correctly to `-c <name>`) on
 * every call after that. Real consequence, stated plainly: new or changed
 * files in an already-indexed project are NOT picked up automatically —
 * the file-watcher EPIC-P3 §3 asks for was not built, because the only
 * real mechanism available for it has a worse side effect than the
 * feature it would add. A project can be re-indexed from scratch by
 * removing its collection (`removeIndex`) and searching again.
 *
 * BUG-0014, found live (2026-09-18) running this hub against its own
 * repo (`hub.config.json`'s `dataDir` nested inside a `projectRoots`
 * entry — a real, ordinary dev setup, not a contrived edge case): every
 * git worktree under `dataDir/worktrees/<sessionId>/` (T2.1) is a full
 * checkout, so it carries its own copy of every real markdown file —
 * README, CONTRIBUTING, every doc — and `qmd` indexed those copies right
 * alongside the originals, real duplicate hits in every search. Checked
 * for a real fix at the source: `qmd` has no `--exclude`/`--ignore` flag
 * (grepped its own bundled skill docs — nothing) and does NOT honor
 * `.gitignore` (`data/` is gitignored in this repo; `qmd ls` still showed
 * every worktree file indexed). So `searchProject()` filters `dataDir`
 * out of qmd's own results after the fact — the only place left to fix
 * this without reaching into qmd's internals.
 */

const execFileAsync = promisify(execFile);

/**
 * BUG-0127: `ANCIENTVOID_QMD_INDEX` wählt einen eigenen benannten qmd-Index (`~/.cache/qmd/<name>.sqlite`,
 * Modelle bleiben geteilt). Die Tests setzen ihn, damit sie nie in den Live-Index schreiben, in den der
 * laufende Hub und parallele Gates zur selben Zeit einbetten. Ohne Variable: der Standard-Index.
 */
function qmd(args: string[], options?: { cwd?: string; maxBuffer?: number }) {
  const index = process.env.ANCIENTVOID_QMD_INDEX;
  return execFileAsync("qmd", index ? ["--index", index, ...args] : args, options ?? {});
}

export interface SearchResult {
  file: string;
  line: number;
  title: string;
  snippet: string;
  score: number;
}

interface QmdQueryHit {
  file?: unknown;
  line?: unknown;
  title?: unknown;
  snippet?: unknown;
  score?: unknown;
}

let qmdAvailableCache: boolean | undefined;

/** Cached after the first real check — qmd's own presence doesn't change
 * mid-process. Reset only matters for tests, which construct a fresh
 * process per run anyway. */
export async function isQmdAvailable(): Promise<boolean> {
  if (qmdAvailableCache !== undefined) return qmdAvailableCache;
  try {
    await execFileAsync("qmd", ["--version"]);
    qmdAvailableCache = true;
  } catch {
    qmdAvailableCache = false;
  }
  return qmdAvailableCache;
}

/** Stable, collision-resistant, space-free collection name derived from
 * the real absolute project path — qmd collection names with spaces are
 * real (the user's own "personal brain" collection has one) but harder
 * to pass safely through argv boundaries, so AncientVoid's own collections never
 * use them. */
export function collectionNameFor(projectPath: string): string {
  return "ancientvoid-" + createHash("sha256").update(projectPath).digest("hex").slice(0, 16);
}

async function collectionExists(name: string): Promise<boolean> {
  const { stdout } = await qmd(["collection", "list"]);
  return stdout.split("\n").some((line) => line.trim().startsWith(`${name} (qmd://`));
}

/**
 * Real, confirmed limitation (2026-09-18, found while building this, not
 * guessed): `qmd collection add --pattern <glob>` silently IGNORES any
 * custom pattern and always indexes `**\/*.md` — verified against a
 * brand-new, otherwise-empty directory containing one `.py` and one
 * `.md` file (only the `.md` one was ever indexed, regardless of the
 * `--pattern` value passed), and confirmed against the tool's own real
 * SQLite schema: `store_collections.pattern TEXT NOT NULL DEFAULT
 * '**\/*.md'`. `qmd status`'s "AST Chunking… Languages: typescript, tsx,
 * javascript, python, go, rust" line describes a CHUNKING strategy for
 * whatever files already got included, not an inclusion filter — it does
 * not mean those file types get indexed.
 *
 * Consequence, stated plainly: T3.8's "Sprachsuche" searches a project's
 * MARKDOWN documentation (epics, ADRs, README, docs/) with this qmd
 * version, not its source code — "Quick Markdown Search" is genuinely
 * markdown-first. Passing `--pattern` anyway (harmless — qmd ignores it
 * rather than erroring) documents the intent for a future qmd version
 * that honors it, without silently overselling today's real behavior in
 * this file's own doc comment.
 */
const DEFAULT_PATTERN = "**/*.md";

export interface IndexStatus {
  qmdAvailable: boolean;
  indexed: boolean;
}

export async function indexStatus(projectPath: string): Promise<IndexStatus> {
  const qmdAvailable = await isQmdAvailable();
  if (!qmdAvailable) return { qmdAvailable: false, indexed: false };
  return { qmdAvailable: true, indexed: await collectionExists(collectionNameFor(projectPath)) };
}

/** Idempotent. First call for a project creates the qmd collection and
 * embeds it (can take real minutes for a large repo — this is why the
 * search route below reports "indexing" rather than blocking on it, see
 * routes.ts). Every later call is cheap (embed no-ops when every content
 * hash already has a vector, verified live: ~0.5s). */
export async function ensureIndexed(projectPath: string): Promise<void> {
  const name = collectionNameFor(projectPath);
  if (!(await collectionExists(name))) {
    await qmd(["collection", "add", projectPath, "--name", name, "--pattern", DEFAULT_PATTERN]);
  }
  await qmd(["embed", "-c", name, "--timeout", "10"], { maxBuffer: 16 * 1024 * 1024 });
}

/** True when `relFile` (already `./`-stripped, forward-slash-separated)
 * lies inside one of `excludeRelDirs` — an exact segment match, so
 * excluding `"data"` correctly leaves a real `data-model.md` alone. */
function isUnderExcludedDir(relFile: string, excludeRelDirs: readonly string[]): boolean {
  return excludeRelDirs.some((dir) => relFile === dir || relFile.startsWith(`${dir}/`));
}

/** BUG-0014: dataDir's path relative to the project, when it's actually
 * nested inside it (the common case that triggers the worktree-duplicate
 * bug — see this file's top doc comment) — undefined (no exclusion)
 * otherwise, never a guess. */
export function relativeDataDir(projectPath: string, dataDir: string): string | undefined {
  const rel = relative(resolve(projectPath), resolve(dataDir));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return rel;
}

/** Real, verified: an explicit `lex:`+`vec:` typed query document takes
 * the hybrid (keyword + semantic) path without qmd's own auto-expansion
 * step (which is what makes plain `qmd query <text>` take 17-30s+ — see
 * this file's doc comment). `--no-rerank` skips the LLM reranker for the
 * same reason.
 *
 * `excludeRelDirs` (BUG-0014): project-relative dirs to drop from qmd's
 * own results — real requirement since qmd has neither an ignore flag
 * nor .gitignore awareness (see top doc comment). Requests more raw hits
 * than `limit` from qmd so filtering some out still leaves a full page. */
export async function searchProject(
  projectPath: string,
  query: string,
  limit = 5,
  excludeRelDirs: readonly string[] = [],
): Promise<SearchResult[]> {
  const name = collectionNameFor(projectPath);
  const doc = `lex: ${query}\nvec: ${query}`;
  const rawLimit = excludeRelDirs.length > 0 ? Math.max(limit * 4, 20) : limit;
  let stdout: string;
  try {
    // Real, verified (qmd --help): `--full-path` renders `./`-prefixed
    // paths "under $PWD", absolute otherwise — cwd MUST be the project
    // directory or every result comes back as an unrelated absolute path.
    ({ stdout } = await qmd(
      ["query", doc, "-c", name, "--format", "json", "-n", String(rawLimit), "--full-path", "--no-rerank"],
      { cwd: projectPath, maxBuffer: 16 * 1024 * 1024 },
    ));
  } catch (err) {
    // A project that was never indexed (or whose collection was removed
    // between indexStatus() and this call — a real, possible race) fails
    // with "Collection not found", not an empty result set. Treated the
    // same as "nothing found" rather than thrown — callers that already
    // check indexStatus() first (the search route) never hit this in
    // practice, but searchProject() itself should be safe to call directly.
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Collection not found")) return [];
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const results: SearchResult[] = [];
  for (const raw of parsed as QmdQueryHit[]) {
    if (typeof raw.file !== "string" || typeof raw.line !== "number") continue;
    const file = raw.file.startsWith("./") ? raw.file.slice(2) : raw.file;
    if (isUnderExcludedDir(file, excludeRelDirs)) continue;
    results.push({
      file,
      line: raw.line,
      title: typeof raw.title === "string" ? raw.title : raw.file,
      snippet: typeof raw.snippet === "string" ? raw.snippet : "",
      score: typeof raw.score === "number" ? raw.score : 0,
    });
    if (results.length >= limit) break;
  }
  return results;
}

const MAX_VIEWABLE_FILE_BYTES = 1_000_000;

export interface ProjectFile {
  path: string;
  content: string;
  lineCount: number;
}

/**
 * Reads a file for the search result's "tap → viewer" flow. `relativePath`
 * is client-supplied (it comes straight out of a SearchResult), so this
 * resolves both the project root AND the requested file through
 * `realpath` and requires the file to genuinely land inside the resolved
 * project directory — the same traversal defense as
 * `@ancientvoid/core`'s `isProjectPathAllowed`, applied one level deeper (a file
 * within an already-allowed project, not the project root itself).
 * Returns `null` for anything outside the project, missing, or too large
 * to hand a mobile client — never throws on attacker input.
 */
export async function readProjectFile(projectPath: string, relativePath: string): Promise<ProjectFile | null> {
  let realProject: string;
  let realFile: string;
  try {
    realProject = await realpath(projectPath);
    realFile = await realpath(join(projectPath, relativePath));
  } catch {
    return null;
  }
  if (realFile !== realProject && !realFile.startsWith(realProject + sep)) return null;
  try {
    const info = await stat(realFile);
    if (!info.isFile() || info.size > MAX_VIEWABLE_FILE_BYTES) return null;
    const content = await readFile(realFile, "utf8");
    return { path: relativePath, content, lineCount: content.split("\n").length };
  } catch {
    return null;
  }
}

export async function removeIndex(projectPath: string): Promise<void> {
  const name = collectionNameFor(projectPath);
  if (await collectionExists(name)) {
    await qmd(["collection", "remove", name]);
  }
}

export interface ProjectDoc {
  path: string;
  /** Erste `# `-Überschrift der Datei — ehrlich null, wenn keine existiert. */
  title: string | null;
  bytes: number;
}

/** Verzeichnisse, die niemals Dokumente beisteuern — VCS- und Paket-Innereien
 * sind keine Doku, und node_modules wäre jede Abhängigkeit mal laut. */
const DOC_SKIP_DIRS = new Set([".git", "node_modules"]);

/**
 * Alle Markdown-Dokumente eines Projekts, strukturiert gelistet — die
 * Dokumentübersicht der Suchansicht (die Liste braucht kein qmd, nur
 * die .md-Dateien die der Index ebenfalls erfasst). Schließt das dataDir
 * aus, wenn es im Projekt liegt (BUG-0014: Worktree-Kopien), und liest pro
 * Datei nur die ersten Zeilen für den Titel.
 */
export async function listProjectDocs(projectPath: string, excludeRelDirs: readonly string[] = []): Promise<ProjectDoc[]> {
  const realProject = await realpath(projectPath).catch(() => null);
  if (!realProject) return [];
  const excluded = new Set(excludeRelDirs);
  const docs: ProjectDoc[] = [];
  const walk = async (absDir: string, relDir: string): Promise<void> => {
    const entries = await readdir(absDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (DOC_SKIP_DIRS.has(entry.name) || excluded.has(rel)) continue;
        await walk(join(absDir, entry.name), rel);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        const abs = join(absDir, entry.name);
        const info = await stat(abs).catch(() => null);
        if (!info || info.size > MAX_VIEWABLE_FILE_BYTES) continue;
        docs.push({ path: rel, title: await docTitle(abs), bytes: info.size });
      }
    }
  };
  await walk(realProject, "");
  docs.sort((a, b) => a.path.localeCompare(b.path));
  return docs;
}

async function docTitle(absPath: string): Promise<string | null> {
  const handle = await open(absPath, "r").catch(() => null);
  if (!handle) return null;
  try {
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    for (const line of buffer.subarray(0, bytesRead).toString("utf8").split("\n")) {
      const heading = /^#\s+(.+?)\s*$/.exec(line);
      if (heading) return heading[1]!;
    }
    return null;
  } finally {
    await handle.close();
  }
}
