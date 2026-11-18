import { z } from "zod";
import { WorkspaceIdentity } from "./code.ts";

/**
 * EPIC-P46 (ADR-0058): Projekt-Explorer — lazy Dateibaum und revisionierter
 * Byte-/Textzugriff. Bewusst getrennt von `CodeFile` (T7.6, 1-MiB-Ansicht),
 * das kompatibel bleibt. Inhalte reisen über Content-Endpunkte, nie als Events (K5).
 */

/** Seitengröße des Baums; der Client kann bis `TREE_PAGE_MAX` anfragen. */
export const TREE_PAGE_DEFAULT = 200;
export const TREE_PAGE_MAX = 1000;
/** Text-/Byte-Chunk: Standard 256 KiB, Obergrenze 1 MiB pro Antwort. */
export const RANGE_DEFAULT_BYTES = 256 * 1024;
export const RANGE_MAX_BYTES = 1024 * 1024;

export const TreeEntryKind = z.enum(["dir", "file", "symlink", "other"]);
export type TreeEntryKind = z.infer<typeof TreeEntryKind>;

export const TreeEntry = z.object({
  name: z.string(),
  /** Pfad relativ zur Root, `/`-getrennt, nie absolut. */
  path: z.string(),
  kind: TreeEntryKind,
  size: z.number().int().nonnegative().nullable(),
  mtimeMs: z.number().nullable(),
  /** Gitstatus; null = unverändert oder kein Git. */
  git: z.enum(["modified", "added", "deleted", "untracked", "ignored", "conflict"]).nullable(),
  /** Zeigt auf ein Ziel innerhalb der Root (Symlink, der ein Ordner ist, öffnet sich als Ordner). */
  symlink: z.boolean().default(false),
  /** Sichtbar gesperrt statt „leer“: `.git`-Interna, Link nach außen, nicht lesbar. */
  blocked: z.string().nullable().default(null),
  /** Statuspunkt aus EPIC-*.md (`**Status:**`) oder bug-*.md (Frontmatter `status:`); sonst null. */
  epic: z.enum(["done", "code", "wip", "open", "blocked"]).nullable().default(null),
  /** Klartext der Statuszeile/des Frontmatter-Werts (gekürzt) — Tooltip statt erratener Bedeutung. */
  epicStatus: z.string().nullable().default(null),
});
export type TreeEntry = z.infer<typeof TreeEntry>;

export const TreeListing = z.object({
  identity: WorkspaceIdentity,
  path: z.string(),
  entries: z.array(TreeEntry),
  /** Anzahl nach Filtern; `entries` ist die Seite ab `offset`. */
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
  /** Ob Ignoriertes eingeblendet ist und wie viel dadurch (nicht) zu sehen war. */
  filters: z.object({ ignored: z.boolean(), ignoredHidden: z.number().int().nonnegative() }),
});
export type TreeListing = z.infer<typeof TreeListing>;

export const ViewerFamily = z.enum(["text", "image", "pdf", "audio", "video", "binary"]);
export type ViewerFamily = z.infer<typeof ViewerFamily>;

export const FileMeta = z.object({
  identity: WorkspaceIdentity,
  path: z.string(),
  bytes: z.number().int().nonnegative(),
  mtimeMs: z.number(),
  /** Inhalts-Revision (Größe + mtime + inode): jede Range-Antwort ist daran gebunden. */
  revision: z.string(),
  /** Familie des Viewers; `binary` = nur Hex/Download. */
  family: ViewerFamily,
  mime: z.string(),
  language: z.string(),
  encoding: z.enum(["utf-8", "utf-16le", "utf-16be", "binary"]),
  /** Länge der BOM in Bytes (0 = keine). */
  bomBytes: z.number().int().nonnegative(),
  eol: z.enum(["lf", "crlf", "mixed", "none"]).nullable(),
  /** Aus dem ersten Chunk geschätzt (Encoding/EOL) — für große Dateien nicht aus dem ganzen Inhalt. */
  sampledBytes: z.number().int().nonnegative(),
});
export type FileMeta = z.infer<typeof FileMeta>;

export const FileRange = z.object({
  revision: z.string(),
  /** Tatsächlicher Start (bei Text auf eine Zeichengrenze ausgerichtet). */
  offset: z.number().int().nonnegative(),
  length: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
  eof: z.boolean(),
  /** Genau eines von beiden gesetzt, je nach `as`. */
  text: z.string().nullable(),
  base64: z.string().nullable(),
  /** Zeilennummer (1-basiert), bei der `text` beginnt; nur bei `as=text`. */
  startLine: z.number().int().positive().nullable().default(null),
});
export type FileRange = z.infer<typeof FileRange>;
