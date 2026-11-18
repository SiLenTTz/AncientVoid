import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  RELEASE_NOTES_BODY_CAP,
  RELEASE_NOTES_MAX_COMMITS,
  RELEASE_NOTES_MAX_ENTRIES,
  RELEASE_NOTES_MAX_FILES,
  type ReleaseNotesCommit,
  type ReleaseNotesDetail,
  type ReleaseNotesEntry,
  type ReleaseNotesFile,
  type ReleaseNotesListReport,
  type ReleaseNotesStats,
} from "@ancientvoid/contracts";
import { parseCommitNotation } from "./notation.ts";

const execFileAsync = promisify(execFile);

const FIELD = "\x1f";
const RECORD = "\x1e";

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    timeout: 8_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout;
}

/** Merge-Commit nicht gefunden oder kein Merge-Commit — Route antwortet 404. */
export class ReleaseNotesNotFoundError extends Error {}

/** `git diff --shortstat`-Zeile → Zahlen; unlesbar → null (nie geraten). */
export function parseShortStat(line: string): ReleaseNotesStats | null {
  const m = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/.exec(line.trim());
  if (!m) return null;
  return { filesChanged: Number(m[1]), insertions: m[2] ? Number(m[2]) : 0, deletions: m[3] ? Number(m[3]) : 0 };
}

function splitRecords(out: string): string[][] {
  return out
    .split(RECORD)
    .filter((r) => r.trim())
    .map((r) => r.split(FIELD).map((f) => f.trim()));
}

function capBody(text: string): { body: string; truncated: boolean } {
  const trimmed = text.trim();
  if (trimmed.length <= RELEASE_NOTES_BODY_CAP) return { body: trimmed, truncated: false };
  return { body: trimmed.slice(0, RELEASE_NOTES_BODY_CAP), truncated: true };
}

/**
 * ADR-0092: Liste der gemergten PRs — Merge-Commits auf dem ersten Parent-Strang.
 * Neueste zuerst; ±Zeilen aus einem zweiten, formatlosen `--shortstat`-Lauf
 * (ein Stat-Block je Merge, per Index zugeordnet — Bodies können keinen
 * Shortstat vortäuschen). Kein Repo / kein Verlauf → benannter `error`.
 */
export async function buildReleaseNotes(root: string, maxEntries = RELEASE_NOTES_MAX_ENTRIES): Promise<ReleaseNotesListReport> {
  const cap = Math.min(Math.max(1, maxEntries), RELEASE_NOTES_MAX_ENTRIES);
  try {
    await git(root, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    return { entries: [], truncated: false, maxEntries: cap, error: "Kein Git-Repository." };
  }

  let logOut: string;
  let statOut: string;
  try {
    const n = String(cap + 1);
    logOut = await git(root, ["log", "--first-parent", "--merges", "-n", n, `--format=%H${FIELD}%cI${FIELD}%cN${FIELD}%s${RECORD}`]);
    statOut = await git(root, ["log", "--first-parent", "--merges", "-n", n, "--format=", "--shortstat"]);
  } catch (err) {
    return { entries: [], truncated: false, maxEntries: cap, error: `Git-Verlauf nicht lesbar: ${err instanceof Error ? err.message : String(err)}` };
  }

  const records = splitRecords(logOut);
  if (records.length === 0) {
    return { entries: [], truncated: false, maxEntries: cap, error: "Keine gemergten Pull-Requests im Verlauf." };
  }
  const truncated = records.length > cap;
  const statLines = statOut.split("\n").filter((l) => l.trim());

  const entries: ReleaseNotesEntry[] = records.slice(0, cap).map((r, i) => ({
    mergeSha: r[0] ?? "",
    shortSha: (r[0] ?? "").slice(0, 7),
    mergedAt: r[1] ?? "",
    mergedBy: r[2] ?? "",
    notation: parseCommitNotation(r[3] ?? ""),
    stats: parseShortStat(statLines[i] ?? ""),
  }));
  return { entries, truncated, maxEntries: cap };
}

/** Ein 40-Hash — Details werden nur mit SHAs aus der Liste angefordert. */
const SHA_RE = /^[0-9a-f]{7,40}$/i;

/**
 * ADR-0092: Detail eines PRs — PR-Beschreibung (Merge-Body), Branch-Commits
 * (`P1..P2`, älteste zuerst), Dateien (name-status) und Stats, alles mit
 * ehrlichen Caps. Unbekannter/kein Merge-Commit → `ReleaseNotesNotFoundError`.
 */
export async function buildReleaseNotesDetail(root: string, mergeSha: string): Promise<ReleaseNotesDetail> {
  if (!SHA_RE.test(mergeSha)) throw new ReleaseNotesNotFoundError("Ungültiger Merge-Commit-Bezeichner.");
  try {
    await git(root, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    throw new ReleaseNotesNotFoundError("Kein Git-Repository.");
  }

  let merge: string[];
  try {
    const out = await git(root, ["show", "-s", `--format=%H${FIELD}%P${FIELD}%cI${FIELD}%s${FIELD}%b${RECORD}`, mergeSha]);
    merge = splitRecords(out)[0] ?? [];
  } catch {
    throw new ReleaseNotesNotFoundError("Merge-Commit nicht gefunden.");
  }
  const parents = (merge[1] ?? "").split(/\s+/).filter(Boolean);
  if ((merge[0] ?? "") === "" || parents.length < 2) {
    throw new ReleaseNotesNotFoundError("Kein Merge-Commit auf dem Hauptstrang.");
  }
  const p1 = parents[0]!;
  const p2 = parents[1]!;

  const [commitOut, filesOut, statOut] = await Promise.all([
    git(root, ["log", `${p1}..${p2}`, "--reverse", `-n`, String(RELEASE_NOTES_MAX_COMMITS + 1), `--format=%H${FIELD}%an${FIELD}%aI${FIELD}%s${FIELD}%b${RECORD}`]),
    git(root, ["diff", "--name-status", p1, mergeSha]),
    git(root, ["diff", "--shortstat", p1, mergeSha]),
  ]);

  const commitRecords = splitRecords(commitOut);
  const commitsTruncated = commitRecords.length > RELEASE_NOTES_MAX_COMMITS;
  const commits: ReleaseNotesCommit[] = commitRecords.slice(0, RELEASE_NOTES_MAX_COMMITS).map((r) => {
    const body = capBody(r[4] ?? "");
    return {
      sha: r[0] ?? "",
      shortSha: (r[0] ?? "").slice(0, 7),
      author: r[1] ?? "",
      date: r[2] ?? "",
      notation: parseCommitNotation(r[3] ?? ""),
      body: body.body,
      bodyTruncated: body.truncated,
    };
  });

  const files: ReleaseNotesFile[] = [];
  let filesTruncated = false;
  for (const line of filesOut.split("\n")) {
    if (!line) continue;
    // name-status: "M\tpath" bzw. Rename "R100\told\tnew" (Ziel = letzter Teil).
    const parts = line.split("\t");
    const status = (parts[0] ?? "").charAt(0) || "?";
    const path = (parts[parts.length - 1] ?? "").trim();
    if (!path) continue;
    files.push({ path, status });
    if (files.length >= RELEASE_NOTES_MAX_FILES) {
      filesTruncated = true;
      break;
    }
  }

  const body = capBody(merge[4] ?? "");
  return {
    mergeSha: merge[0] ?? "",
    mergedAt: merge[2] ?? "",
    notation: parseCommitNotation(merge[3] ?? ""),
    body: body.body,
    bodyTruncated: body.truncated,
    commits,
    commitsTruncated,
    files,
    filesTruncated,
    stats: parseShortStat(statOut),
  };
}
