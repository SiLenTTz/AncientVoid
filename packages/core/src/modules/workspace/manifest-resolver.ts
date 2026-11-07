import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import {
  MAX_WORKSPACE_DETAIL_CHARS,
  WorkspaceManifest,
  WORKSPACE_MANIFEST_FILENAME,
  WORKSPACE_MANIFEST_MAX_BYTES,
} from "@ancientvoid/contracts";

const execFileAsync = promisify(execFile);

/**
 * EPIC-P29 T29.2 / ADR-0051 §2: Das Manifest wird an der festgehaltenen
 * Basis-SHA gelesen (`git show`), nie aus dem beweglichen Arbeitsverzeichnis
 * — nachträgliche Änderungen an der Datei wechseln nicht unbemerkt das
 * Verhalten aktiver Workspaces. Ohne Manifest bleibt der T2.1-Pfad (status
 * "none", kein Fehler). Ungültige Version/Felder/Größe failen laut.
 */
export type ResolvedManifest =
  | { status: "none" }
  | { status: "ok"; manifest: WorkspaceManifest; manifestHash: string }
  | { status: "invalid"; manifestHash: string | null; reason: string };

export async function resolveManifest(projectPath: string, baseSha: string | null): Promise<ResolvedManifest> {
  if (baseSha === null) return { status: "none" };
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("git", ["-C", projectPath, "show", `${baseSha}:${WORKSPACE_MANIFEST_FILENAME}`], {
      maxBuffer: WORKSPACE_MANIFEST_MAX_BYTES * 2,
    }));
  } catch (err) {
    const stderr = err instanceof Error ? err.message : String(err);
    // "path ... does not exist" (auch "exists on disk, but not in") heißt:
    // kein Manifest — das ist der alte, unveränderte Pfad, kein Defekt.
    if (stderr.includes("does not exist") || stderr.includes("but not in")) return { status: "none" };
    return { status: "invalid", manifestHash: null, reason: capped(stderr) };
  }
  if (Buffer.byteLength(stdout, "utf8") > WORKSPACE_MANIFEST_MAX_BYTES) {
    return { status: "invalid", manifestHash: null, reason: `Manifest größer als ${WORKSPACE_MANIFEST_MAX_BYTES} Byte` };
  }
  const manifestHash = sha256(stdout);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { status: "invalid", manifestHash, reason: "Manifest ist kein gültiges JSON" };
  }
  const result = WorkspaceManifest.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join("/") || "<wurzel>"}: ${issue.message}`)
      .join("; ");
    return { status: "invalid", manifestHash, reason: capped(`Manifest verletzt den Vertrag v1 — ${issues}`) };
  }
  return { status: "ok", manifest: result.data, manifestHash };
}

/** sha256 (Hex) des exakten Dateiinhalts an der Basis-SHA — Inhaltsgleichheit ist Hash-Gleichheit. */
export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function capped(text: string): string {
  const firstLine = text.split("\n").find((line) => line.trim() !== "") ?? "";
  return firstLine.trim().slice(0, MAX_WORKSPACE_DETAIL_CHARS);
}
