import { execFile, spawn } from "node:child_process";
import { open, readdir, realpath, lstat, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  RANGE_DEFAULT_BYTES,
  RANGE_MAX_BYTES,
  TREE_PAGE_DEFAULT,
  TREE_PAGE_MAX,
  type FileMeta,
  type FileRange,
  type TreeEntry,
  type TreeListing,
  type ViewerFamily,
  type WorkspaceIdentity,
} from "@ancientvoid/contracts";
import { languageOf } from "./file.ts";

const run = promisify(execFile);
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** Natürliche, deterministische Reihenfolge: Ordner zuerst, dann numerisch-bewusst, Rohname als Tiebreak. */
export function compareEntries(a: { name: string; kind: string }, b: { name: string; kind: string }): number {
  const dirA = a.kind === "dir" ? 0 : 1;
  const dirB = b.kind === "dir" ? 0 : 1;
  if (dirA !== dirB) return dirA - dirB;
  return collator.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

const clean = (rel: string) => rel.split(sep).join("/").replace(/^\.\//, "").replace(/\/$/, "");

/** Pfad innerhalb der Root (Datei ODER Ordner), über Symlinks aufgelöst; `.git`-Interna und Ausbrüche → null. */
async function containedPath(root: string, path: string): Promise<{ real: string; rel: string } | null> {
  if (isAbsolute(path) || path.includes("\0")) return null;
  try {
    const realRoot = await realpath(root);
    const real = await realpath(resolve(root, path || "."));
    if (real !== realRoot && !real.startsWith(realRoot + sep)) return null;
    const rel = relative(realRoot, real);
    if (rel.split(sep).includes(".git")) return null;
    return { real, rel: clean(rel) };
  } catch {
    return null;
  }
}

async function gitOut(cwd: string, args: string[]): Promise<string | null> {
  try {
    return (await run("git", args, { cwd, timeout: 15_000, maxBuffer: 16 * 1024 * 1024 })).stdout;
  } catch {
    return null;
  }
}

/** Welche der Pfade (relativ zur Root) git ignoriert — ein Aufruf pro Seite. */
async function ignoredSet(root: string, paths: string[]): Promise<Set<string>> {
  if (paths.length === 0) return new Set();
  return new Promise((done) => {
    const child = spawn("git", ["check-ignore", "-z", "--stdin"], { cwd: root, stdio: ["pipe", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
    child.on("error", () => done(new Set()));
    child.on("close", () => done(new Set(out.split("\0").filter(Boolean))));
    child.stdin.on("error", () => undefined);
    child.stdin.end(paths.join("\0") + "\0");
  });
}

/** Gitstatus je Pfad (relativ zur Root) für einen Ordner. */
async function statusMap(root: string, dir: string): Promise<Map<string, NonNullable<TreeEntry["git"]>>> {
  const map = new Map<string, NonNullable<TreeEntry["git"]>>();
  const prefix = ((await gitOut(root, ["rev-parse", "--show-prefix"])) ?? "").trim();
  const out = await gitOut(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", dir || "."]);
  if (!out) return map;
  const parts = out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]!;
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    let file = entry.slice(3);
    if (xy.includes("R") || xy.includes("C")) i++; // nächster Eintrag ist die Quelle
    if (prefix && file.startsWith(prefix)) file = file.slice(prefix.length);
    const state: NonNullable<TreeEntry["git"]> =
      xy === "??" ? "untracked" : xy.includes("U") || xy === "AA" || xy === "DD" ? "conflict" : xy.includes("D") ? "deleted" : xy.includes("A") ? "added" : "modified";
    map.set(file, state);
  }
  return map;
}

export interface TreeOptions {
  offset?: number;
  limit?: number;
  /** Ignoriertes (z. B. node_modules) einblenden — sonst nur gezählt. */
  ignored?: boolean;
}

/**
 * ADR-0058 §2: ein Ordner, lazy und paginiert. Nie rekursiv; ignorierte Einträge
 * werden gezählt statt still verschwiegen; Links nach außen und `.git` sind sichtbar gesperrt.
 */
export async function listTree(root: string, path: string, identity: WorkspaceIdentity, options: TreeOptions = {}): Promise<TreeListing | null> {
  const dir = await containedPath(root, path);
  if (!dir || !(await stat(dir.real).then((s) => s.isDirectory(), () => false))) return null;
  const realRoot = await realpath(root);
  const names = await readdir(dir.real, { withFileTypes: true });
  const base = dir.rel;
  const isGit = (await gitOut(root, ["rev-parse", "--is-inside-work-tree"]))?.trim() === "true";
  const raw: TreeEntry[] = [];
  for (const d of names) {
    const rel = base ? `${base}/${d.name}` : d.name;
    const abs = resolve(dir.real, d.name);
    let kind: TreeEntry["kind"] = d.isDirectory() ? "dir" : d.isFile() ? "file" : d.isSymbolicLink() ? "symlink" : "other";
    let blocked: string | null = null;
    let symlink = false;
    let size: number | null = null;
    let mtimeMs: number | null = null;
    try {
      const l = await lstat(abs);
      size = l.isFile() ? l.size : null;
      mtimeMs = l.mtimeMs;
      if (l.isSymbolicLink()) {
        const target = await realpath(abs).catch(() => null);
        if (!target) blocked = "Link ins Leere";
        else if (target !== realRoot && !target.startsWith(realRoot + sep)) blocked = "Link zeigt aus dem Projekt heraus";
        else {
          const ts = await stat(target);
          kind = ts.isDirectory() ? "dir" : ts.isFile() ? "file" : "other";
          size = ts.isFile() ? ts.size : null;
          symlink = true;
        }
      }
    } catch {
      blocked = "nicht lesbar";
    }
    if (d.name === ".git") blocked = ".git-Interna sind gesperrt";
    raw.push({ name: d.name, path: rel, kind, size, mtimeMs, git: null, symlink, blocked });
  }
  const ignored = isGit ? await ignoredSet(root, raw.filter((e) => e.name !== ".git").map((e) => e.path)) : new Set<string>();
  const status = isGit ? await statusMap(root, base) : new Map<string, NonNullable<TreeEntry["git"]>>();
  for (const e of raw) {
    if (ignored.has(e.path) || ignored.has(`${e.path}/`)) e.git = "ignored";
    else e.git = status.get(e.path) ?? status.get(`${e.path}/`) ?? ([...status.keys()].some((k) => k.startsWith(`${e.path}/`)) ? "modified" : null);
  }
  const hiddenCount = raw.filter((e) => e.git === "ignored").length;
  const shown = (options.ignored ? raw : raw.filter((e) => e.git !== "ignored")).sort(compareEntries);
  const limit = Math.min(Math.max(options.limit ?? TREE_PAGE_DEFAULT, 1), TREE_PAGE_MAX);
  const offset = Math.max(options.offset ?? 0, 0);
  const entries = shown.slice(offset, offset + limit);
  return {
    identity,
    path: base,
    entries,
    total: shown.length,
    offset,
    nextOffset: offset + entries.length < shown.length ? offset + entries.length : null,
    filters: { ignored: options.ignored === true, ignoredHidden: options.ignored ? 0 : hiddenCount },
  };
}

const MIME: Record<string, [string, ViewerFamily]> = {
  ".png": ["image/png", "image"], ".jpg": ["image/jpeg", "image"], ".jpeg": ["image/jpeg", "image"], ".gif": ["image/gif", "image"],
  ".webp": ["image/webp", "image"], ".avif": ["image/avif", "image"], ".bmp": ["image/bmp", "image"], ".ico": ["image/x-icon", "image"],
  ".pdf": ["application/pdf", "pdf"],
  ".mp3": ["audio/mpeg", "audio"], ".wav": ["audio/wav", "audio"], ".ogg": ["audio/ogg", "audio"], ".m4a": ["audio/mp4", "audio"], ".flac": ["audio/flac", "audio"],
  ".mp4": ["video/mp4", "video"], ".webm": ["video/webm", "video"], ".mov": ["video/quicktime", "video"],
};

/** SVG ist Bild UND Text: die Source-Ansicht bleibt Standard, Preview nur passiv (<img>, nie inline). */
export function mimeOf(path: string): { mime: string; family: ViewerFamily | null } {
  const ext = extname(path).toLowerCase();
  if (ext === ".svg") return { mime: "image/svg+xml", family: null };
  const hit = MIME[ext];
  return hit ? { mime: hit[0], family: hit[1] } : { mime: "application/octet-stream", family: null };
}

/** Revision: ändert sich mit Größe, mtime oder Inode — ein Austausch der Datei mitten im Lesen fällt auf. */
export function revisionOf(s: { size: number; mtimeMs: number; ino: number }): string {
  return createHash("sha1").update(`${s.size}:${s.mtimeMs}:${s.ino}`).digest("hex").slice(0, 16);
}

function sniff(buf: Buffer): { encoding: FileMeta["encoding"]; bomBytes: number } {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { encoding: "utf-8", bomBytes: 3 };
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return { encoding: "utf-16le", bomBytes: 2 };
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return { encoding: "utf-16be", bomBytes: 2 };
  if (buf.includes(0)) return { encoding: "binary", bomBytes: 0 };
  return { encoding: "utf-8", bomBytes: 0 };
}

function eolOf(text: string): FileMeta["eol"] {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length - crlf;
  if (crlf === 0 && lf === 0) return "none";
  return crlf > 0 && lf > 0 ? "mixed" : crlf > 0 ? "crlf" : "lf";
}

const SAMPLE = 64 * 1024;

export interface ResolvedFile {
  real: string;
  rel: string;
  size: number;
  mtimeMs: number;
  revision: string;
}

export async function resolveFile(root: string, path: string): Promise<ResolvedFile | null> {
  const hit = await containedPath(root, path);
  if (!hit) return null;
  try {
    const s = await stat(hit.real);
    if (!s.isFile()) return null;
    return { real: hit.real, rel: hit.rel, size: s.size, mtimeMs: s.mtimeMs, revision: revisionOf(s) };
  } catch {
    return null;
  }
}

export async function fileMeta(root: string, path: string, identity: WorkspaceIdentity): Promise<FileMeta | null> {
  const file = await resolveFile(root, path);
  if (!file) return null;
  const handle = await open(file.real, "r");
  let head: Buffer;
  try {
    head = Buffer.alloc(Math.min(file.size, SAMPLE));
    await handle.read(head, 0, head.length, 0);
  } finally {
    await handle.close();
  }
  const { encoding, bomBytes } = sniff(head);
  const known = mimeOf(file.rel);
  // Ein bekanntes Medienformat gewinnt gegen die Binär-Heuristik; Unbekanntes mit Nullbytes ist `binary`.
  const family: ViewerFamily = known.family ?? (encoding === "binary" ? "binary" : "text");
  const text = encoding === "utf-16le" ? head.subarray(bomBytes).toString("utf16le") : encoding === "utf-16be" ? Buffer.from(head.subarray(bomBytes)).swap16().toString("utf16le") : encoding === "utf-8" ? head.subarray(bomBytes).toString("utf8") : "";
  return {
    identity,
    path: file.rel,
    bytes: file.size,
    mtimeMs: file.mtimeMs,
    revision: file.revision,
    family,
    mime: family === "text" ? (known.mime === "application/octet-stream" ? "text/plain" : known.mime) : known.mime,
    language: family === "binary" ? "binary" : languageOf(file.rel),
    encoding: family === "text" ? encoding : "binary",
    bomBytes: family === "text" ? bomBytes : 0,
    eol: family === "text" ? eolOf(text) : null,
    sampledBytes: head.length,
  };
}

export type RangeResult = { ok: true; range: FileRange } | { ok: false; reason: "not_found" | "revision_changed"; revision?: string };

/** Auf die nächste UTF-8-Zeichengrenze ab `start` (Fortsetzungsbytes 10xxxxxx überspringen). */
function alignStart(buf: Buffer): number {
  let i = 0;
  while (i < buf.length && i < 4 && (buf[i]! & 0xc0) === 0x80) i++;
  return i;
}

/** Länge, die vollständige UTF-8-Zeichen enthält (unvollständiges Ende bleibt für den nächsten Chunk). */
function completeUtf8(buf: Buffer): number {
  let end = buf.length;
  for (let back = 1; back <= 4 && back <= buf.length; back++) {
    const b = buf[buf.length - back]!;
    if ((b & 0xc0) === 0x80) continue;
    const need = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1;
    if (need > back) end = buf.length - back;
    break;
  }
  return end;
}

/**
 * ADR-0058 §3: ein Bereich einer Datei, an `revision` gebunden. Text startet auf einer Zeichengrenze
 * (UTF-8/UTF-16, nie mitten im Surrogatpaar) und meldet `nextOffset` für die Fortsetzung.
 */
export async function readRange(
  root: string,
  path: string,
  opts: { offset: number; length?: number; revision?: string; as: "text" | "bytes"; encoding?: FileMeta["encoding"] },
): Promise<RangeResult> {
  const file = await resolveFile(root, path);
  if (!file) return { ok: false, reason: "not_found" };
  if (opts.revision && opts.revision !== file.revision) return { ok: false, reason: "revision_changed", revision: file.revision };
  const want = Math.min(Math.max(opts.length ?? RANGE_DEFAULT_BYTES, 1), RANGE_MAX_BYTES);
  const offset = Math.min(Math.max(opts.offset, 0), file.size);
  const handle = await open(file.real, "r");
  let buf: Buffer;
  try {
    buf = Buffer.alloc(Math.min(want + 4, Math.max(file.size - offset, 0)));
    const { bytesRead } = await handle.read(buf, 0, buf.length, offset);
    buf = buf.subarray(0, bytesRead);
    // Datei während des Lesens ausgetauscht? Dann nichts Gemischtes ausliefern.
    const after = await handle.stat();
    if (revisionOf(after) !== file.revision) return { ok: false, reason: "revision_changed", revision: revisionOf(after) };
  } finally {
    await handle.close();
  }
  if (opts.as === "bytes") {
    const slice = buf.subarray(0, want);
    const end = offset + slice.length;
    return { ok: true, range: { revision: file.revision, offset, length: slice.length, nextOffset: end < file.size ? end : null, eof: end >= file.size, text: null, base64: slice.toString("base64") } };
  }
  const encoding = opts.encoding ?? "utf-8";
  let skip: number;
  let keep: number;
  let text: string;
  if (encoding === "utf-16le" || encoding === "utf-16be") {
    const bom = offset === 0 ? sniff(buf).bomBytes : 0;
    skip = bom + (((offset + bom) % 2) ? 1 : 0);
    let usable = Math.min(buf.length, want) - skip;
    usable -= usable % 2;
    let slice = buf.subarray(skip, skip + usable);
    if (encoding === "utf-16be") slice = Buffer.from(slice).swap16();
    // Ein einzelnes High-Surrogate am Ende gehört zum nächsten Chunk.
    if (slice.length >= 2) {
      const last = slice.readUInt16LE(slice.length - 2);
      if (last >= 0xd800 && last <= 0xdbff && skip + usable < file.size) {
        slice = slice.subarray(0, slice.length - 2);
        usable -= 2;
      }
    }
    keep = usable;
    text = slice.toString("utf16le");
  } else {
    const bom = offset === 0 ? sniff(buf).bomBytes : 0;
    skip = bom || alignStart(buf);
    const body = buf.subarray(skip, Math.min(buf.length, want + skip));
    const whole = skip + body.length >= file.size - offset ? body.length : completeUtf8(body);
    keep = whole;
    text = body.subarray(0, whole).toString("utf8");
  }
  const start = offset + skip;
  const end = start + keep;
  return { ok: true, range: { revision: file.revision, offset: start, length: keep, nextOffset: end < file.size ? end : null, eof: end >= file.size, text, base64: null } };
}
