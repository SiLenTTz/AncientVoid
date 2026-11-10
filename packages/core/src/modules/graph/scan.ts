import { execFile } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { GRAPH_MAX_FILES, GRAPH_SCAN_MAX_BYTES, graphGroupOf, isGraphEntry, type GraphEdge, type GraphEdgeKind, type GraphNode, type GraphReport } from "@ancientvoid/contracts";

const run = promisify(execFile);

/** Feste Ausschlüsse des Fallback-Walks; mit git-Aufzählung fällt Ignoriertes über .gitignore raus. */
const WALK_SKIP: Record<string, true> = { ".git": true, node_modules: true, dist: true, ".cache": true, ".turbo": true, coverage: true };
/** Datei-Familien, deren Inhalt nach Kanten gescannt wird. */
const SCAN_EXT: Record<string, true> = {
  ".ts": true, ".tsx": true, ".mts": true, ".cts": true, ".js": true, ".jsx": true, ".mjs": true, ".cjs": true,
  ".md": true, ".mdx": true, ".css": true, ".scss": true, ".py": true, ".html": true, ".htm": true,
};
const JS_FAMILY: Record<string, true> = { ".ts": true, ".tsx": true, ".mts": true, ".cts": true, ".js": true, ".jsx": true, ".mjs": true, ".cjs": true };
const MD_FAMILY: Record<string, true> = { ".md": true, ".mdx": true };
const CSS_FAMILY: Record<string, true> = { ".css": true, ".scss": true };
const HTML_FAMILY: Record<string, true> = { ".html": true, ".htm": true };

export interface GraphScanOptions {
  maxFiles?: number;
  scanMaxBytes?: number;
  /** Relative Pfade, die ausgeschlossen werden (z. B. das dataDir des Hubs, BUG-0014). */
  exclude?: readonly string[];
}

interface Ref {
  spec: string;
  kind: GraphEdgeKind;
}

const extOf = (path: string): string => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
};

function isExcluded(rel: string, exclude: readonly string[]): boolean {
  return exclude.some((ex) => rel === ex || rel.startsWith(`${ex}/`));
}

/** Arbeitsstand: tracked + untracked, ignoriertes ausgenommen (respektiert .gitignore). */
async function listGitFiles(root: string, exclude: readonly string[]): Promise<string[] | null> {
  try {
    const { stdout } = await run("git", ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { maxBuffer: 16 * 1024 * 1024, timeout: 30_000 });
    const all = stdout.split("\0").filter((p) => p !== "" && !p.startsWith(".git/") && !isExcluded(p, exclude));
    all.sort();
    return all;
  } catch {
    return null;
  }
}

async function walkFiles(root: string, exclude: readonly string[], max: number): Promise<string[]> {
  const out: string[] = [];
  const dirs: string[] = [""];
  while (dirs.length > 0 && out.length <= max) {
    const rel = dirs.shift()!;
    const entries = (await readdir(join(root, rel), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const child = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (child in WALK_SKIP || isExcluded(child, exclude)) continue;
        dirs.push(child);
      } else if (e.isFile()) {
        out.push(child);
      }
    }
  }
  out.sort();
  return out.slice(0, max + 1);
}

const JS_PATTERNS: RegExp[] = [
  /\bimport\s+[^;'"()]*?from\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\bexport\s+[^;'"()]*?from\s*["']([^"']+)["']/g,
  /\brequire\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
];

const isRelativeSpec = (s: string): boolean => s.startsWith("./") || s.startsWith("../");
const stripQuery = (s: string): string => s.split(/[?#]/, 1)[0] ?? s;
const isLinkTarget = (t: string): boolean => t !== "" && !/^[a-z][a-z0-9+.-]*:/i.test(t) && !t.startsWith("//") && !t.startsWith("/") && !t.startsWith("#");

function collectJs(out: Ref[], text: string): void {
  for (const re of JS_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const spec = m[1] ?? "";
      if (isRelativeSpec(spec)) out.push({ spec: stripQuery(spec), kind: "import" });
    }
  }
}

function collectMd(out: Ref[], text: string): void {
  for (const m of text.matchAll(/\[[^\]]*\]\(\s*<?([^)\s>]*)>?[^)]*\)/g)) {
    const target = stripQuery((m[1] ?? "").split("#")[0] ?? "");
    if (isLinkTarget(target)) out.push({ spec: target, kind: "link" });
  }
  for (const m of text.matchAll(/^[ \t]{0,3}\[[^\]]+\]:[ \t]*(\S+)/gm)) {
    const target = stripQuery((m[1] ?? "").split("#")[0] ?? "");
    if (isLinkTarget(target)) out.push({ spec: target, kind: "link" });
  }
}

function collectCss(out: Ref[], text: string): void {
  for (const m of text.matchAll(/@import\s+(?:url\(\s*)?["']?([^"'()\s;]+)/g)) {
    const spec = m[1] ?? "";
    if (isRelativeSpec(spec) || !spec.startsWith("/")) out.push({ spec: stripQuery(spec), kind: "asset" });
  }
  for (const m of text.matchAll(/url\(\s*["']?([^"'()\s]+)["']?\s*\)/g)) {
    const spec = m[1] ?? "";
    if (spec !== "" && !spec.startsWith("/") && !/^[a-z][a-z0-9+.-]*:/i.test(spec)) out.push({ spec: stripQuery(spec), kind: "asset" });
  }
}

function collectHtml(out: Ref[], text: string): void {
  for (const m of text.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)) {
    const spec = m[1] ?? "";
    if (isLinkTarget(spec) && !spec.startsWith("#")) out.push({ spec: stripQuery(spec), kind: "asset" });
  }
}

function collectPy(out: Ref[], text: string, rel: string): void {
  const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
  const parts = dir === "" ? [] : dir.split("/");
  for (const m of text.matchAll(/^[ \t]*from[ \t]+(\.+)([\w.]*)[ \t]+import\b/gm)) {
    const dots = m[1]?.length ?? 0;
    const mod = m[2] ?? "";
    // N führende Punkte: das Paket selbst ist (n-1) Ebenen höher.
    const up = Math.max(0, parts.length - (dots - 1));
    const base = parts.slice(0, up).join("/");
    const spec = mod === "" ? base : base === "" ? mod.replace(/\./g, "/") : `${base}/${mod.replace(/\./g, "/")}`;
    if (spec !== "" && !spec.startsWith("../")) out.push({ spec, kind: "pyimport" });
  }
}

/** Kanten-Kandidaten einer Datei — Verweise, keine Sprachsemantik (ADR-0062 §3). */
function refsOf(rel: string, text: string): Ref[] {
  const out: Ref[] = [];
  const ext = extOf(rel);
  if (ext in JS_FAMILY) collectJs(out, text);
  else if (ext in MD_FAMILY) collectMd(out, text);
  else if (ext in CSS_FAMILY) collectCss(out, text);
  else if (ext in HTML_FAMILY) collectHtml(out, text);
  else if (ext === ".py") collectPy(out, text, rel);
  return out;
}

const RESOLVE_SUFFIX = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css", ".scss", ".md", ".mdx", ".py", ".svg", ".html", ".htm"];
const INDEX_SUFFIX = ["/index.ts", "/index.tsx", "/index.js"];
const PY_SUFFIX = [".py", "/__init__.py"];

function resolveRef(fromDir: string, spec: string, files: ReadonlySet<string>, kind: GraphEdgeKind): string | null {
  const joined = normalizePosix(kind === "pyimport" ? spec : `${fromDir}/${spec}`);
  if (joined === "" || joined === ".." || joined.startsWith("../") || joined.startsWith("/")) return null;
  const suffixes = kind === "pyimport" ? PY_SUFFIX : RESOLVE_SUFFIX.concat(INDEX_SUFFIX);
  for (const s of suffixes) {
    const cand = `${joined}${s}`;
    if (files.has(cand)) return cand;
  }
  return null;
}

function normalizePosix(p: string): string {
  const out: string[] = [];
  for (const part of p.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else out.push("..");
    } else out.push(part);
  }
  return out.join("/");
}

/**
 * EPIC-P48 (ADR-0062): Dateien als Knoten, relative Import-/Verweis-Beziehungen als Kanten.
 * Ehrliche Kappung bei maxFiles; unauflösbare Spezifikatoren erzeugen keine Phantomknoten.
 */
export async function buildFileGraph(root: string, opts: GraphScanOptions = {}): Promise<GraphReport> {
  const maxFiles = opts.maxFiles ?? GRAPH_MAX_FILES;
  const scanMaxBytes = opts.scanMaxBytes ?? GRAPH_SCAN_MAX_BYTES;
  const exclude = opts.exclude ?? [];
  let files = await listGitFiles(root, exclude);
  let enumeration: "git" | "walk" = "git";
  if (!files) {
    enumeration = "walk";
    files = await walkFiles(root, exclude, maxFiles);
  }
  const truncated = files.length > maxFiles;
  const limited = truncated ? files.slice(0, maxFiles) : files;
  const fileSet = new Set(limited);
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const sizes = new Map<string, number>();
  let unresolved = 0;
  for (const rel of limited) {
    const abs = join(root, rel);
    let size = 0;
    try {
      size = (await stat(abs)).size;
    } catch {
      continue;
    }
    sizes.set(rel, size);
    if (size > scanMaxBytes || !(extOf(rel) in SCAN_EXT)) continue;
    let text: string;
    try {
      text = await readFile(abs, "utf8");
    } catch {
      continue;
    }
    if (text.includes("\u0000")) continue; // Binärinhalt erkennt man am NUL-Byte.
    const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
    for (const ref of refsOf(rel, text)) {
      const to = resolveRef(dir, ref.spec, fileSet, ref.kind);
      if (!to) {
        unresolved++;
        continue;
      }
      const key = `${rel}\u0000${to}\u0000${ref.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: rel, to, kind: ref.kind });
    }
  }
  edges.sort((a, b) => (a.from === b.from ? a.to === b.to ? a.kind.localeCompare(b.kind) : a.to.localeCompare(b.to) : a.from.localeCompare(b.from)));
  const outDeg = new Map<string, number>();
  const inDeg = new Map<string, number>();
  for (const e of edges) {
    outDeg.set(e.from, (outDeg.get(e.from) ?? 0) + 1);
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
  }
  const nodes: GraphNode[] = limited.map((p) => ({ path: p, group: graphGroupOf(p), bytes: sizes.get(p) ?? 0, out: outDeg.get(p) ?? 0, in: inDeg.get(p) ?? 0, entry: isGraphEntry(p) }));
  return { root, scope: "working-tree", nodes, edges, meta: { files: nodes.length, edgeCount: edges.length, truncated, maxFiles, unresolved, enumeration } };
}
