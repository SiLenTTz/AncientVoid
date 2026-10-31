import { execFile } from "node:child_process";
import { open, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { CODE_FILE_MAX_BYTES, type CodeFile, type WorkspaceIdentity } from "@ancientvoid/contracts";

const run = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    return (await run("git", args, { cwd, timeout: 10_000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
  } catch {
    return null;
  }
}

/** Which checkout a view shows (T7.6 "Worktree-Identität"). */
export async function workspaceIdentity(root: string, session: { id: string; base: string | null } | null): Promise<WorkspaceIdentity> {
  const branch = await git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return {
    kind: session ? "session" : "project",
    sessionId: session?.id ?? null,
    root,
    branch: branch && branch !== "HEAD" ? branch : null,
    head: await git(root, ["rev-parse", "HEAD"]),
    base: session?.base ?? null,
  };
}

/**
 * A path inside `root`, resolved through symlinks — null when it leaves
 * the root, does not exist, or is not a regular file.
 */
export async function containedFile(root: string, path: string): Promise<string | null> {
  if (!path || isAbsolute(path) || path.includes("\0")) return null;
  let real: string;
  let realRoot: string;
  try {
    realRoot = await realpath(root);
    real = await realpath(resolve(root, path));
  } catch {
    return null;
  }
  if (real !== realRoot && !real.startsWith(realRoot + sep)) return null;
  const rel = relative(realRoot, real);
  if (rel.split(sep).includes(".git")) return null;
  try {
    if (!(await stat(real)).isFile()) return null;
  } catch {
    return null;
  }
  return real;
}

const LANGUAGES: Record<string, string> = {
  ".ts": "typescript", ".tsx": "typescript", ".mts": "typescript", ".cts": "typescript",
  ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".py": "python", ".go": "go", ".rs": "rust", ".java": "java", ".kt": "kotlin",
  ".sh": "shell", ".bash": "shell", ".json": "json", ".md": "markdown", ".yml": "yaml", ".yaml": "yaml",
  ".toml": "toml", ".css": "css", ".html": "html", ".sql": "sql", ".c": "c", ".h": "c", ".cpp": "cpp",
};

export function languageOf(path: string): string {
  return LANGUAGES[extname(path).toLowerCase()] ?? "text";
}

/** Reads one file for the viewer; the caller checked who may see `root`. */
export async function readCodeFile(root: string, path: string, identity: WorkspaceIdentity, changed: CodeFile["changed"] = null): Promise<CodeFile | null> {
  const real = await containedFile(root, path);
  if (!real) return null;
  const size = (await stat(real)).size;
  const handle = await open(real, "r");
  let buf: Buffer;
  try {
    buf = Buffer.alloc(Math.min(size, CODE_FILE_MAX_BYTES));
    await handle.read(buf, 0, buf.length, 0);
  } finally {
    await handle.close();
  }
  const binary = buf.subarray(0, 8000).includes(0);
  const content = binary ? "" : buf.toString("utf8");
  const clean = path.split(sep).join("/").replace(/^\.\//, "");
  return {
    identity,
    path: clean,
    language: binary ? "binary" : languageOf(path),
    bytes: size,
    lines: binary ? 0 : content.split("\n").length - (content.endsWith("\n") ? 1 : 0),
    content,
    truncated: size > CODE_FILE_MAX_BYTES,
    binary,
    blobSha: await git(root, ["hash-object", "--", clean]),
    changed,
  };
}
