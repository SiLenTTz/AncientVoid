import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  GIT_GRAPH_MAX_COMMITS,
  GIT_GRAPH_MAX_FILES_PER_COMMIT,
  type GitGraphBranch,
  type GitGraphCommit,
  type GitGraphFile,
  type GitGraphReport,
} from "@ancientvoid/contracts";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    timeout: 8_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout;
}

function parseFiles(block: string): { files: GitGraphFile[]; truncated: boolean } {
  const files: GitGraphFile[] = [];
  for (const line of block.split("\n")) {
    if (!line) continue;
    // name-status: "M\tpath" oder rename "R100\told\tnew"
    const parts = line.split("\t");
    const status = (parts[0] ?? "").charAt(0) || "?";
    const path = parts.length >= 3 ? (parts[2] ?? parts[1] ?? "") : (parts[1] ?? "");
    if (!path) continue;
    files.push({ path, status });
    if (files.length >= GIT_GRAPH_MAX_FILES_PER_COMMIT) {
      return { files, truncated: true };
    }
  }
  return { files, truncated: false };
}

/**
 * Read-only Commit-DAG für die PWA-Git-Graph-Ansicht (ADR-0071).
 * Neueste zuerst; Caps ehrlich; kein Repo → benannter `error`.
 */
export async function buildGitGraph(root: string, maxCommits = GIT_GRAPH_MAX_COMMITS): Promise<GitGraphReport> {
  const cap = Math.min(Math.max(1, maxCommits), GIT_GRAPH_MAX_COMMITS);
  try {
    await git(root, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    return { commits: [], branches: [], head: null, truncated: false, maxCommits: cap, error: "Kein Git-Repository." };
  }

  const head = await git(root, ["rev-parse", "HEAD"])
    .then((s) => s.trim() || null)
    .catch(() => null);

  const refMap = new Map<string, string[]>();
  const branches: GitGraphBranch[] = [];
  try {
    const refsOut = await git(root, ["for-each-ref", "--format=%(objectname)\x1f%(refname:short)", "refs/heads", "refs/tags", "refs/remotes"]);
    let color = 0;
    const seen = new Set<string>();
    for (const line of refsOut.split("\n").filter(Boolean)) {
      const [sha, name] = line.split("\x1f");
      if (!sha || !name) continue;
      const list = refMap.get(sha) ?? [];
      list.push(name);
      refMap.set(sha, list);
      if (seen.has(name)) continue;
      seen.add(name);
      branches.push({ name, sha, colorIndex: color % 8 });
      color += 1;
    }
  } catch {
    // refs optional — Graph ohne Labels bleibt nutzbar
  }

  let truncated = false;
  let logOut: string;
  try {
    logOut = await git(root, [
      "log",
      "--all",
      "--date-order",
      `-n`,
      String(cap + 1),
      "--format=%x1e%H%x1f%P%x1f%h%x1f%an%x1f%aI%x1f%s",
      "--name-status",
    ]);
  } catch (err) {
    return {
      commits: [],
      branches,
      head,
      truncated: false,
      maxCommits: cap,
      error: err instanceof Error ? err.message : "git log fehlgeschlagen",
    };
  }

  const raw = logOut.split("\x1e").filter((b) => b.trim());
  if (raw.length > cap) {
    truncated = true;
    raw.length = cap;
  }

  const commits: GitGraphCommit[] = [];
  for (const block of raw) {
    const nl = block.indexOf("\n");
    const header = (nl >= 0 ? block.slice(0, nl) : block).trim();
    const body = nl >= 0 ? block.slice(nl + 1) : "";
    const [sha, parentsRaw, shortSha, author, date, ...subjectParts] = header.split("\x1f");
    if (!sha) continue;
    const { files, truncated: filesTruncated } = parseFiles(body);
    const commit: GitGraphCommit = {
      sha,
      shortSha: shortSha ?? sha.slice(0, 7),
      parents: (parentsRaw ?? "").split(" ").filter(Boolean),
      author: author ?? "",
      date: date ?? "",
      subject: subjectParts.join("\x1f"),
      refs: refMap.get(sha) ?? [],
      files,
    };
    if (filesTruncated) commit.filesTruncated = true;
    commits.push(commit);
  }

  if (commits.length === 0) {
    return { commits: [], branches, head, truncated: false, maxCommits: cap, error: "Kein Commit-Verlauf." };
  }

  return { commits, branches, head, truncated, maxCommits: cap };
}
