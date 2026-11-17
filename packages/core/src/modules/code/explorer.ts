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

/** Epic-Datei im Baum: Namenskonvention der Epic-Pakete (EPIC-P0…, EPIC-P43.5…). */
const EPIC_FILE = /^EPIC-[A-Za-z]?[0-9.]+.*\.md$/i;
/** Wie viel vom Dateianfang die Statuszeile / das Frontmatter enthält. */
const EPIC_HEAD_BYTES = 4096;
const BUG_FILE = /^bug-\d+.*\.md$/i;

type StatusDot = { epic: "done" | "code" | "wip" | "open"; text: string };

/**
 * Nutzerauftrag 14.11.2026: Kategorie aus der Statuszeile einer EPIC-*.md.
 * Reihenfolge ist wichtig — „Code abgeschlossen“ enthält „abgeschlossen“,
 * „Umsetzung: gesperrt“ enthält „Umsetzung“. Der Klartext (`text`) geht mit
 * an die Oberfläche; die Kategorie ist Heuristik, kein Semantic-Parser.
 */
export function epicStatusOf(head: string): StatusDot | null {
  const line = head.split("\n").find((l) => l.includes("**Status:**"));
  if (!line) return null;
  const text = line.replace(/\*\*Status:\*\*/, "").replace(/\*\*/g, "").trim().slice(0, 220);
  if (/code abgeschlossen|teilweise umgesetzt|exit offen/i.test(text)) return { epic: "code", text };
  if (/abgeschlossen|exit grün|fertiggestellt/i.test(text)) return { epic: "done", text };
  if (/in umsetzung|umsetzung: freigegeben/i.test(text)) return { epic: "wip", text };
  if (/\bumgesetzt\b|\bgebaut\b/i.test(text)) return { epic: "code", text };
  return { epic: "open", text };
}

/**
 * BUG-0189: Frontmatter `status:` einer bug-*.md → dieselben Punkt-Kategorien
 * wie Epics (done/wip/open; `code` ungenutzt). Unbekannte Werte → open.
 */
export function bugStatusOf(head: string): StatusDot | null {
  if (!head.startsWith("---")) return null;
  const end = head.indexOf("\n---", 3);
  if (end < 0) return null;
  const line = head.slice(3, end).split("\n").find((l) => /^\s*status\s*:/i.test(l));
  if (!line) return null;
  const text = line.replace(/^\s*status\s*:\s*/i, "").replace(/^["']|["']$/g, "").trim().slice(0, 220);
  if (!text) return null;
  const v = text.toLowerCase();
  if (v === "done") return { epic: "done", text };
  if (v === "in-progress" || v === "in arbeit" || v.startsWith("in arbeit")) return { epic: "wip", text };
  return { epic: "open", text };
}

/** Epic-/Bug-Status für die Dateien einer Baumseite anreichern (nur sichtbare Seite, nie rekursiv). */
async function annotateEpics(root: string, entries: TreeEntry[]): Promise<void> {
  for (const e of entries) {
    if (e.kind !== "file" || e.blocked !== null) continue;
    const kind = EPIC_FILE.test(e.name) ? "epic" : BUG_FILE.test(e.name) ? "bug" : null;
    if (!kind) continue;
    if (e.size !== null && e.size > 256 * 1024) continue; // Status-MDs sind klein
    try {
      const handle = await open(resolve(root, e.path), "r");
      try {
        const buf = Buffer.alloc(EPIC_HEAD_BYTES);
        const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
        const head = buf.subarray(0, bytesRead).toString("utf8");
        const hit = kind === "epic" ? epicStatusOf(head) : bugStatusOf(head);
        if (hit) {
          e.epic = hit.epic;
          e.epicStatus = hit.text;
        }
      } finally {
        await handle.close();
      }
    } catch {
      // Nicht lesbar bleibt unsichtbar markiert (kein Statuspunkt statt Fehler).
    }
  }
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
    raw.push({ name: d.name, path: rel, kind, size, mtimeMs, git: null, symlink, blocked, epic: null, epicStatus: null });
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
  await annotateEpics(root, entries);
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

async function bomOf(real: string): Promise<number> {
  const handle = await open(real, "r");
  try {
    const head = Buffer.alloc(3);
    const { bytesRead } = await handle.read(head, 0, 3, 0);
    return sniff(head.subarray(0, bytesRead)).bomBytes;
  } finally {
    await handle.close();
  }
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
    return { ok: true, range: { revision: file.revision, offset, length: slice.length, nextOffset: end < file.size ? end : null, eof: end >= file.size, text: null, base64: slice.toString("base64"), startLine: null } };
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
  const startLine = await lineAtOffset(file.real, file.revision, start, encoding, await bomOf(file.real));
  return { ok: true, range: { revision: file.revision, offset: start, length: keep, nextOffset: end < file.size ? end : null, eof: end >= file.size, text, base64: null, startLine } };
}

// ---- Zeilenindex, Zeilensprung, Textsuche (ADR-0058 §8) --------------------------------------------------

/** Checkpoints (Byte-Offset → Zeilennummer) je Datei-Revision, damit sequenzielles Blättern nicht von vorn zählt. */
const lineCheckpoints = new Map<string, Map<number, number>>();
const CHECKPOINT_EVERY = 1024 * 1024;
const MAX_CACHED_FILES = 64;

function checkpointsFor(key: string): Map<number, number> {
  let map = lineCheckpoints.get(key);
  if (!map) {
    if (lineCheckpoints.size >= MAX_CACHED_FILES) lineCheckpoints.delete(lineCheckpoints.keys().next().value as string);
    map = new Map([[0, 1]]);
    lineCheckpoints.set(key, map);
  }
  return map;
}

type Enc = FileMeta["encoding"];
const isWide = (e: Enc) => e === "utf-16le" || e === "utf-16be";

/** Newline-Anzahl in einem ausgerichteten Bytebereich (UTF-8: Byte 0x0A; UTF-16: dekodiert). */
function newlinesIn(buf: Buffer, enc: Enc): number {
  if (!isWide(enc)) {
    let n = 0;
    for (let i = 0; i < buf.length; i++) if (buf[i] === 0x0a) n++;
    return n;
  }
  const even = buf.subarray(0, buf.length - (buf.length % 2));
  const text = enc === "utf-16be" ? Buffer.from(even).swap16().toString("utf16le") : even.toString("utf16le");
  return text.split("\n").length - 1;
}

/** Zeilennummer (1-basiert) der Zeile, die bei `offset` beginnt bzw. enthält; `offset` muss ausgerichtet sein. */
export async function lineAtOffset(real: string, revision: string, offset: number, enc: Enc, bomBytes: number): Promise<number> {
  const cps = checkpointsFor(`${real}:${revision}`);
  let from = bomBytes;
  let line = 1;
  for (const [o, l] of cps) if (o <= offset && o >= from) { from = o; line = l; }
  const handle = await open(real, "r");
  try {
    const step = 256 * 1024 - (256 * 1024 % 2);
    for (let pos = from; pos < offset; ) {
      const len = Math.min(step, offset - pos);
      const buf = Buffer.alloc(len);
      const { bytesRead } = await handle.read(buf, 0, len, pos);
      if (bytesRead === 0) break;
      line += newlinesIn(buf.subarray(0, bytesRead), enc);
      pos += bytesRead;
      if (pos % CHECKPOINT_EVERY < step && pos <= offset) cps.set(pos - (pos % 2), line);
    }
  } finally {
    await handle.close();
  }
  return line;
}

/** Byte-Offset des Anfangs von Zeile `line` (1-basiert); null, wenn die Datei kürzer ist. */
export async function offsetOfLine(real: string, enc: Enc, bomBytes: number, size: number, line: number): Promise<number | null> {
  if (line <= 1) return bomBytes;
  const handle = await open(real, "r");
  try {
    const step = 256 * 1024;
    let seen = 1;
    for (let pos = bomBytes; pos < size; ) {
      const buf = Buffer.alloc(Math.min(step, size - pos));
      const { bytesRead } = await handle.read(buf, 0, buf.length, pos);
      if (bytesRead === 0) break;
      const chunk = buf.subarray(0, bytesRead);
      if (!isWide(enc)) {
        for (let i = 0; i < chunk.length; i++) if (chunk[i] === 0x0a && ++seen === line) return pos + i + 1;
      } else {
        const unit = chunk.length - (chunk.length % 2);
        for (let i = 0; i < unit; i += 2) {
          const code = enc === "utf-16le" ? chunk.readUInt16LE(i) : chunk.readUInt16BE(i);
          if (code === 0x0a && ++seen === line) return pos + i + 2;
        }
        pos -= chunk.length - unit; // ungerades Restbyte gehört zum nächsten Block
      }
      pos += bytesRead;
    }
    return null;
  } finally {
    await handle.close();
  }
}

export type FindResult =
  | { ok: true; found: true; revision: string; lineOffset: number; line: number; column: number; length: number }
  | { ok: true; found: false; revision: string; scannedBytes: number }
  | { ok: false; reason: "not_found" | "revision_changed"; revision?: string };

const FIND_BUDGET_BYTES = 512 * 1024 * 1024;

/**
 * Nächster Treffer ab `from` (Byte-Offset, ausgerichtet): hostseitig über die ganze Datei, nicht nur über den
 * geladenen Abschnitt. Liefert den Zeilenanfang (zum Öffnen des Abschnitts), die Zeilennummer und die Spalte
 * in UTF-16-Einheiten.
 */
export async function findInFile(
  root: string,
  path: string,
  opts: { query: string; from: number; revision?: string; encoding: Enc; bomBytes: number; caseSensitive?: boolean },
): Promise<FindResult> {
  const file = await resolveFile(root, path);
  if (!file) return { ok: false, reason: "not_found" };
  if (opts.revision && opts.revision !== file.revision) return { ok: false, reason: "revision_changed", revision: file.revision };
  const wide = isWide(opts.encoding);
  const needle = opts.caseSensitive ? opts.query : opts.query.toLowerCase();
  let offset = Math.max(opts.from, opts.bomBytes);
  let line = await lineAtOffset(file.real, file.revision, offset, opts.encoding, opts.bomBytes);
  const startedAt = offset;
  let carry = "";
  let carryStart = offset; // Byte-Offset, an dem `carry` beginnt
  let lineAtCarry = line;
  for (let guard = 0; offset < file.size && offset - startedAt < FIND_BUDGET_BYTES; guard++) {
    const res = await readRange(root, path, { offset, length: RANGE_MAX_BYTES, revision: file.revision, as: "text", encoding: opts.encoding });
    if (!res.ok) return res.reason === "revision_changed" ? { ok: false, reason: "revision_changed", ...(res.revision ? { revision: res.revision } : {}) } : { ok: false, reason: "not_found" };
    const r = res.range;
    if (r.length === 0) break;
    if (guard === 0) {
      carry = "";
      carryStart = r.offset;
      lineAtCarry = line;
    }
    const text = carry + (r.text ?? "");
    const hay = opts.caseSensitive ? text : text.toLowerCase();
    const idx = hay.indexOf(needle);
    if (idx >= 0) {
      const before = text.slice(0, idx);
      const nl = before.lastIndexOf("\n");
      const lineStartText = before.slice(0, nl + 1);
      const bytes = (s: string) => (wide ? s.length * 2 : Buffer.byteLength(s, "utf8"));
      const lineStartOffset = carryStart + bytes(lineStartText);
      line = lineAtCarry + (before.match(/\n/g)?.length ?? 0);
      return { ok: true, found: true, revision: file.revision, lineOffset: lineStartOffset, line, column: before.length - (nl + 1) + 1, length: opts.query.length };
    }
    // Überlappung für Treffer über Abschnittsgrenzen; Zeilenzähler fortschreiben
    const keep = Math.max(needle.length - 1, 0);
    const dropped = text.slice(0, text.length - keep);
    lineAtCarry += dropped.match(/\n/g)?.length ?? 0;
    carry = text.slice(text.length - keep);
    carryStart = carryStart + (wide ? dropped.length * 2 : Buffer.byteLength(dropped, "utf8"));
    if (r.nextOffset === null) break;
    offset = r.nextOffset;
  }
  return { ok: true, found: false, revision: file.revision, scannedBytes: Math.min(offset, file.size) - startedAt };
}
