import { copyFile, lstat, mkdir, realpath, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WorkspaceIncludePath, WORKSPACE_INCLUDE_MAX, WORKSPACE_INCLUDE_MAX_BYTES } from "@ancientvoid/contracts";

const execFileAsync = promisify(execFile);

/**
 * EPIC-P29 T29.2 / ADR-0051 §2: explizite, opt-in Dateiübernahme aus dem
 * Quellprojekt in den Worktree — vor dem Setup (T29.3). Nur reguläre,
 * gitignorierte Dateien innerhalb des Quellprojekts; keine Symlinks, kein
 * Traversal, keine absoluten Pfade, kein `.git`/`data`, kein Überschreiben
 * verfolgter Zieldateien; Anzahl und Bytes begrenzt.
 *
 * Der Bericht enthält Pfade und Bytezahlen — nie Dateiinhalte (K5/PRD §8.5:
 * auch `.env`-Inhalte bleiben außerhalb von Events, Logs und Berichten).
 */
export interface IncludeCopyReport {
  copied: { path: string; bytes: number }[];
  rejected: { path: string; reason: string }[];
}

export interface IncludeCopyLimits {
  maxFiles: number;
  maxBytes: number;
}

export const DEFAULT_INCLUDE_LIMITS: IncludeCopyLimits = {
  maxFiles: WORKSPACE_INCLUDE_MAX,
  maxBytes: WORKSPACE_INCLUDE_MAX_BYTES,
};

export async function copyIncludedFiles(
  projectPath: string,
  worktreePath: string,
  include: readonly string[],
  limits: IncludeCopyLimits = DEFAULT_INCLUDE_LIMITS,
): Promise<IncludeCopyReport> {
  const report: IncludeCopyReport = { copied: [], rejected: [] };
  let totalBytes = 0;
  for (const entry of include) {
    const reject = (reason: string): void => {
      report.rejected.push({ path: entry, reason });
    };
    // Pfadform aus dem Vertrag (Traversal/Globs/absolut/.git/data) — auch bei
    // Aufrufern, die das Manifest-Schema umgangen haben.
    if (!WorkspaceIncludePath.safeParse(entry).success) {
      reject("Pfadform verletzt den Vertrag (relativ, ohne Traversal/Globs/.git/data)");
      continue;
    }
    const source = resolve(projectPath, entry);
    if (!source.startsWith(projectPath + sep)) {
      reject("Pfad verlässt das Quellprojekt");
      continue;
    }
    let info;
    try {
      info = await lstat(source);
    } catch {
      reject("Datei fehlt im Quellprojekt");
      continue;
    }
    if (info.isSymbolicLink()) {
      reject("Symlinks werden nicht übernommen");
      continue;
    }
    if (!info.isFile()) {
      reject("keine reguläre Datei");
      continue;
    }
    // Auch über symlinked übergeordnete Verzeichnisse nicht ausbrechen.
    let realSource: string;
    let realRoot: string;
    try {
      [realSource, realRoot] = await Promise.all([realpath(source), realpath(projectPath)]);
    } catch {
      reject("Pfad lässt sich nicht sicher auflösen");
      continue;
    }
    if (!realSource.startsWith(realRoot + sep)) {
      reject("Pfad verlässt das Quellprojekt");
      continue;
    }
    if (await isTrackedIn(worktreePath, entry)) {
      // Getrackte Dateien sind ohnehin im Worktree-Checkout — Übernahme
      // hieße Überschreiben. (Git meldet getrackte Dateien zudem nie als
      // "ignored"; dieser Check nennt die schärfere Ursache zuerst.)
      reject("überschriebe eine verfolgte Datei im Worktree");
      continue;
    }
    const ignored = await checkGitIgnored(projectPath, entry);
    if (ignored === "error") {
      reject("Git-Ignore-Prüfung fehlgeschlagen");
      continue;
    }
    if (!ignored) {
      reject("nicht gitignoriert — Übernahme ist opt-in für lokale Dateien");
      continue;
    }
    const bytes = (await stat(source)).size;
    if (report.copied.length >= limits.maxFiles || totalBytes + bytes > limits.maxBytes) {
      reject("Budget (Anzahl/Bytes) der Dateiübernahme überschritten");
      continue;
    }
    try {
      await mkdir(dirname(join(worktreePath, entry)), { recursive: true });
      await copyFile(source, join(worktreePath, entry));
    } catch (err) {
      reject(`Kopieren fehlgeschlagen (${(err as NodeJS.ErrnoException).code ?? "unbekannt"})`);
      continue;
    }
    totalBytes += bytes;
    report.copied.push({ path: entry, bytes });
  }
  return report;
}

/** true = gemustert als ignoriert, false = nicht ignoriert, "error" = Git selbst versagte (fail loud). */
async function checkGitIgnored(projectPath: string, entry: string): Promise<boolean | "error"> {
  try {
    await execFileAsync("git", ["-C", projectPath, "check-ignore", "--quiet", "--", entry]);
    return true; // Exit 0
  } catch (err) {
    if ((err as { code?: number }).code === 1) return false;
    return "error";
  }
}

async function isTrackedIn(worktreePath: string, entry: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", worktreePath, "ls-files", "--", entry]);
    return stdout.trim() !== "";
  } catch {
    return true; // unklar ⇒ nicht überschreiben (fail safe, AGENTS Regel 6)
  }
}
