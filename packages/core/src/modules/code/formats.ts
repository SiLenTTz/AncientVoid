import { open } from "node:fs/promises";
import { officeText } from "../attachments/index.ts";
import { readFile } from "node:fs/promises";
import { resolveFile } from "./explorer.ts";

/** ADR-0058 §10: Archiv- und Office-Ansichten sind Inhaltsverzeichnis bzw. Textauszug — kein Entpacken, kein Rendern. */
const ENTRY_CAP = 5000;
const OFFICE_MAX_BYTES = 32 * 1024 * 1024;

export interface ArchiveEntry {
  name: string;
  size: number;
  compressedSize: number;
  directory: boolean;
  encrypted: boolean;
}

export type ArchiveListing = { ok: true; revision: string; entries: ArchiveEntry[]; total: number; truncated: boolean } | { ok: false; reason: "not_found" | "unsupported" | "corrupt"; detail: string };

/** ZIP-Zentralverzeichnis lesen (EOCD am Dateiende); es wird nichts entpackt. ZIP64 wird erkannt und ehrlich abgelehnt. */
export async function listZip(root: string, path: string): Promise<ArchiveListing> {
  const file = await resolveFile(root, path);
  if (!file) return { ok: false, reason: "not_found", detail: "Datei nicht gefunden" };
  const handle = await open(file.real, "r");
  try {
    const tailLen = Math.min(file.size, 66_000);
    const tail = Buffer.alloc(tailLen);
    await handle.read(tail, 0, tailLen, file.size - tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return { ok: false, reason: "unsupported", detail: "Kein ZIP-Archiv (Zentralverzeichnis nicht gefunden)" };
    const total = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return { ok: false, reason: "unsupported", detail: "ZIP64 wird nicht aufgelistet — Hex-Ansicht zeigt die Bytes" };
    if (cdSize > 16 * 1024 * 1024) return { ok: false, reason: "corrupt", detail: "Zentralverzeichnis unplausibel groß" };
    const cd = Buffer.alloc(cdSize);
    await handle.read(cd, 0, cdSize, cdOffset);
    const entries: ArchiveEntry[] = [];
    for (let pos = 0; pos + 46 <= cd.length && entries.length < ENTRY_CAP; ) {
      if (cd.readUInt32LE(pos) !== 0x02014b50) return { ok: false, reason: "corrupt", detail: "Zentralverzeichnis beschädigt" };
      const flags = cd.readUInt16LE(pos + 8);
      const compressedSize = cd.readUInt32LE(pos + 20);
      const size = cd.readUInt32LE(pos + 24);
      const nameLen = cd.readUInt16LE(pos + 28);
      const extraLen = cd.readUInt16LE(pos + 30);
      const commentLen = cd.readUInt16LE(pos + 32);
      const name = cd.subarray(pos + 46, pos + 46 + nameLen).toString(flags & 0x800 ? "utf8" : "latin1");
      entries.push({ name, size, compressedSize, directory: name.endsWith("/"), encrypted: (flags & 1) === 1 });
      pos += 46 + nameLen + extraLen + commentLen;
    }
    return { ok: true, revision: file.revision, entries, total, truncated: total > entries.length };
  } finally {
    await handle.close();
  }
}

export interface OfficeSection {
  title: string;
  text: string;
}

export type OfficeText = { ok: true; revision: string; sections: OfficeSection[]; note: string } | { ok: false; reason: "not_found" | "too_large" | "unreadable"; detail: string };

/** Textauszug aus DOCX/XLSX/PPTX/ODF je Folie/Tabelle — ausdrücklich keine Layout-Wiedergabe. */
export async function officeSections(root: string, path: string): Promise<OfficeText> {
  const file = await resolveFile(root, path);
  if (!file) return { ok: false, reason: "not_found", detail: "Datei nicht gefunden" };
  if (file.size > OFFICE_MAX_BYTES) return { ok: false, reason: "too_large", detail: `Größer als ${OFFICE_MAX_BYTES / 1024 / 1024} MiB — Hex-Ansicht und Download bleiben möglich` };
  let text: string;
  try {
    text = officeText(new Uint8Array(await readFile(file.real)), file.rel);
  } catch (err) {
    return { ok: false, reason: "unreadable", detail: `Nicht lesbar: ${err instanceof Error ? err.message : String(err)}` };
  }
  const parts = text.split(/^--- (Folie|Tabelle) (\d+) ---$/m);
  const sections: OfficeSection[] = [];
  if (parts.length === 1) sections.push({ title: "Dokument", text: text.trim() });
  else for (let i = 1; i + 2 < parts.length + 1; i += 3) sections.push({ title: `${parts[i]} ${parts[i + 1]}`, text: (parts[i + 2] ?? "").trim() });
  return { ok: true, revision: file.revision, sections, note: "Textauszug, keine Layout-Wiedergabe — Bilder, Formatierung und Diagramme fehlen." };
}
