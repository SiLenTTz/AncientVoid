import type { FileMeta } from "@ancientvoid/contracts";

/** Eine Datei-Quelle: Worktree einer Session oder Projektordner. Der Schlüssel trennt Tree-/Tab-IDs. */
export type FilesRoot = { kind: "session"; id: string; label: string } | { kind: "project"; path: string; label: string };

export const rootTarget = (root: FilesRoot): string =>
  root.kind === "session" ? `session=${encodeURIComponent(root.id)}` : `project=${encodeURIComponent(root.path)}`;
export const rootKey = (root: FilesRoot): string => (root.kind === "session" ? `s:${root.id}` : `p:${root.path}`);

export interface OpenTab {
  rootKey: string;
  path: string;
}

const KEY = "ancientvoid.files.v1";

export interface FilesState {
  width: number;
  open: boolean;
  showIgnored: boolean;
  root: FilesRoot | null;
  tabs: OpenTab[];
  active: number;
}

export const defaultFilesState = (): FilesState => ({ width: 380, open: false, showIgnored: false, root: null, tabs: [], active: -1 });

/** Gerätelokal, versioniert — keine neue Session-Wahrheit (ADR-0058 §6). */
export function loadFilesState(): FilesState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<FilesState> | null;
    if (!raw) return defaultFilesState();
    return { ...defaultFilesState(), ...raw, width: Math.min(Math.max(Number(raw.width) || 380, 280), 1100) };
  } catch {
    return defaultFilesState();
  }
}

export function saveFilesState(state: FilesState): void {
  localStorage.setItem(KEY, JSON.stringify(state));
}

/** Seitengröße der Text-Abschnitte (Speicherbudget: genau ein Abschnitt im DOM) und der Hex-Ansicht. */
export const TEXT_PAGE_BYTES = 256 * 1024;
export const HEX_PAGE_BYTES = 4096;
/** Größte Datei, die als Blob-Vorschau/Download in den Speicher geladen wird. */
export const BLOB_MAX_BYTES = 64 * 1024 * 1024;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MiB`;
  return `${(n / 1024 ** 3).toFixed(2)} GiB`;
}

/** Eine Hex-Zeile (16 Bytes): Offset, Hex, ASCII — `base64` ist ein Abschnitt ab `offset`. */
export function hexRows(base64: string, offset: number): { offset: string; hex: string; ascii: string }[] {
  const bin = atob(base64);
  const rows: { offset: string; hex: string; ascii: string }[] = [];
  for (let i = 0; i < bin.length; i += 16) {
    const chunk = bin.slice(i, i + 16);
    const bytes = [...chunk].map((c) => c.charCodeAt(0));
    rows.push({
      offset: (offset + i).toString(16).padStart(8, "0"),
      hex: bytes.map((b) => b.toString(16).padStart(2, "0")).join(" "),
      ascii: bytes.map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : "·")).join(""),
    });
  }
  return rows;
}

export const metaSummary = (m: FileMeta): string =>
  `${formatBytes(m.bytes)} · ${m.family === "text" ? `${m.encoding}${m.eol && m.eol !== "none" ? ` · ${m.eol.toUpperCase()}` : ""} · ${m.language}` : m.mime}`;
