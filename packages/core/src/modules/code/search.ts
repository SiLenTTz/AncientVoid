import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CodeMatch, CodeSearchMode } from "@uacc/contracts";

const run = promisify(execFile);

export const MAX_MATCHES = 100;
const MAX_LINE_CHARS = 300;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Lines that define `name` in the languages we meet: TS/JS (function,
 * class, interface, type, enum, const/let/var, methods), Python (def,
 * class), Go (func), Rust (fn, struct, enum, trait), Shell (name()).
 */
export function definitionPattern(name: string): string {
  const n = escapeRegex(name);
  return [
    `\\b(export\\s+)?(default\\s+)?(async\\s+)?function\\*?\\s+${n}\\b`,
    `\\b(export\\s+)?(abstract\\s+)?(class|interface|type|enum)\\s+${n}\\b`,
    `\\b(export\\s+)?(const|let|var)\\s+${n}\\s*[=:]`,
    `^\\s*(public\\s+|private\\s+|protected\\s+|static\\s+|async\\s+|readonly\\s+)*${n}\\s*(<[^>]*>)?\\([^)]*\\)\\s*(:[^={]+)?\\{`,
    `^\\s*(async\\s+)?def\\s+${n}\\b`,
    `^\\s*class\\s+${n}\\b`,
    `\\bfunc\\s+(\\([^)]*\\)\\s*)?${n}\\b`,
    `\\b(pub\\s+)?(fn|struct|enum|trait)\\s+${n}\\b`,
    `^\\s*${n}\\s*\\(\\)\\s*\\{`,
  ].join("|");
}

export const SYMBOL_NAME = /^[A-Za-z_$][\w$]{0,99}$/;

interface RgMatch {
  type: string;
  data?: { path?: { text?: string }; lines?: { text?: string }; line_number?: number; submatches?: { start: number }[] };
}

function clip(text: string): string {
  const t = text.replace(/\s+$/, "");
  return t.length > MAX_LINE_CHARS ? `${t.slice(0, MAX_LINE_CHARS - 1)}…` : t;
}

async function hasRipgrep(): Promise<boolean> {
  try {
    await run("rg", ["--version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export interface CodeSearchOptions {
  mode: CodeSearchMode;
  /** Directories (relative to root) left out, e.g. the hub's dataDir. */
  exclude?: string[];
  limit?: number;
}

/**
 * Local code search (T7.6): ripgrep (respects .gitignore), `git grep` as
 * the fallback. The query is a literal string in text mode; in symbol mode
 * a name, and definitions come first. No index, no network.
 */
export async function searchCode(root: string, query: string, opts: CodeSearchOptions): Promise<{ engine: "ripgrep" | "git-grep"; matches: CodeMatch[]; truncated: boolean }> {
  const limit = Math.min(opts.limit ?? MAX_MATCHES, MAX_MATCHES);
  if (opts.mode === "symbol" && !SYMBOL_NAME.test(query)) throw new Error("Symbolsuche braucht einen Namen (Buchstaben, Ziffern, _).");
  const definition = opts.mode === "symbol" ? new RegExp(definitionPattern(query)) : null;
  const matches: CodeMatch[] = [];
  let engine: "ripgrep" | "git-grep";
  if (await hasRipgrep()) {
    engine = "ripgrep";
    const args = ["--json", "--max-count", "50", "--max-filesize", "1M", "--max-columns", "2000", "-g", "!.git", "-g", "!node_modules"];
    for (const dir of opts.exclude ?? []) args.push("-g", `!${dir}`);
    if (opts.mode === "symbol") args.push("-w", "-e", query);
    else args.push("-F", "-i", "-e", query);
    args.push("--", ".");
    const stdout = await rgRun(root, args);
    for (const line of stdout.split("\n")) {
      if (!line.includes('"type":"match"')) continue;
      const m = JSON.parse(line) as RgMatch;
      const path = m.data?.path?.text;
      const text = m.data?.lines?.text ?? "";
      if (!path || !m.data?.line_number) continue;
      matches.push({
        path: path.replace(/^\.\//, ""),
        line: m.data.line_number,
        column: (m.data.submatches?.[0]?.start ?? 0) + 1,
        text: clip(text),
        kind: definition?.test(text) ? "definition" : "match",
      });
    }
  } else {
    engine = "git-grep";
    const args = ["grep", "-n", "--column", "-I", "--no-color"];
    if (opts.mode === "symbol") args.push("-w", "-e", query);
    else args.push("-F", "-i", "-e", query);
    args.push("--", ".", ...(opts.exclude ?? []).map((d) => `:(exclude)${d}`));
    const stdout = await run("git", args, { cwd: root, maxBuffer: 20 * 1024 * 1024, timeout: 30_000 }).then(
      (r) => r.stdout,
      (err: { code?: number; stdout?: string }) => (err.code === 1 ? "" : Promise.reject(err)),
    );
    for (const line of stdout.split("\n")) {
      const m = /^(.+?):(\d+):(\d+):(.*)$/.exec(line);
      if (!m) continue;
      matches.push({ path: m[1]!, line: Number(m[2]), column: Number(m[3]), text: clip(m[4]!), kind: definition?.test(m[4]!) ? "definition" : "match" });
    }
  }
  // Definitions first, then by path and line — stable for the phone.
  matches.sort((a, b) => (a.kind === b.kind ? a.path.localeCompare(b.path) || a.line - b.line : a.kind === "definition" ? -1 : 1));
  return { engine, matches: matches.slice(0, limit), truncated: matches.length > limit };
}

async function rgRun(cwd: string, args: string[]): Promise<string> {
  try {
    return (await run("rg", args, { cwd, maxBuffer: 20 * 1024 * 1024, timeout: 30_000 })).stdout;
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    if (e.code === 1) return ""; // no match
    if (e.code === 2 && e.stdout) return e.stdout; // some files unreadable — matches still count
    throw new Error(`Suche fehlgeschlagen: ${(e.stderr ?? String(err)).slice(0, 200)}`, { cause: err });
  }
}
