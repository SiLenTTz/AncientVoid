/** EPIC-P48 (ADR-0062): Repo-Graph — Dateien als Knoten, Import-/Verweisbeziehungen als Kanten. */

/** Farbgruppe eines Knotens; die PWA rendert `doc` in der Akzentfarbe des Nutzers. */
export type GraphGroup = "doc" | "code" | "config" | "other";

/** Art einer Kante — Verweise, keine Sprachsemantik (ADR-0062 §3). */
export type GraphEdgeKind = "import" | "link" | "asset" | "pyimport";

export interface GraphNode {
  /** Posix-relativer Pfad zur Wurzel des Ziels (Session-Worktree bzw. Projekt). */
  path: string;
  group: GraphGroup;
  bytes: number;
  /** Grad: Anzahl ausgehender bzw. eingehender Kanten. */
  out: number;
  in: number;
  /** Einstiegspunkt-Heuristik: zählt ohne Zufluss nicht als tote Datei. */
  entry: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: GraphEdgeKind;
}

export interface GraphReport {
  root: string;
  /** Arbeitsstand (tracked + untracked, ignoriertes ausgenommen) — nicht HEAD. */
  scope: "working-tree";
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: {
    files: number;
    edgeCount: number;
    truncated: boolean;
    maxFiles: number;
    /** Spezifikatoren, die auf keine existierende Datei aufgelöst werden konnten. */
    unresolved: number;
    /** Wie aufgezählt wurde: git (respektiert .gitignore) oder Fallback-Walk. */
    enumeration: "git" | "walk";
  };
}

/** Diagnose-Überlagerung (nur auf explizite Anfrage): Fehler je Datei. */
export interface GraphDiagFile {
  path: string;
  errors: number;
  warnings: number;
}

export interface GraphDiagSource {
  name: string;
  state: "ok" | "errors" | "not_configured" | "untrusted" | "timeout" | "failed";
  detail: string | null;
}

export interface GraphDiagnosis {
  sources: GraphDiagSource[];
  byFile: GraphDiagFile[];
}

/** Knoten-Cap; darüber wird ehrlich gekappt (`meta.truncated`). */
export const GRAPH_MAX_FILES = 4000;
/** Größte Datei, die nach Kanten gescannt wird; größere zählen ohne ausgehende Kanten. */
export const GRAPH_SCAN_MAX_BYTES = 512 * 1024;

const DOC_EXT: Record<string, true> = { ".md": true, ".mdx": true };
const CODE_EXT: Record<string, true> = {
  ".ts": true, ".tsx": true, ".mts": true, ".cts": true, ".js": true, ".jsx": true, ".mjs": true, ".cjs": true,
  ".py": true, ".sh": true, ".bash": true, ".zsh": true, ".rs": true, ".go": true, ".java": true, ".c": true,
  ".h": true, ".cpp": true, ".hpp": true, ".rb": true, ".php": true, ".lua": true, ".sql": true, ".vue": true, ".svelte": true,
};
const CONFIG_EXT: Record<string, true> = {
  ".json": true, ".jsonc": true, ".yaml": true, ".yml": true, ".toml": true, ".ini": true, ".cfg": true,
  ".conf": true, ".properties": true, ".lock": true, ".xml": true, ".svg": true, ".css": true, ".scss": true,
};
const CONFIG_NAMES: Record<string, true> = {
  ".gitignore": true, ".gitattributes": true, ".npmrc": true, ".nvmrc": true, ".editorconfig": true,
  ".prettierrc": true, ".eslintrc": true,
};
const ENTRY_FILES: Record<string, true> = {
  "package.json": true, ".gitignore": true, ".gitattributes": true, ".npmrc": true, ".editorconfig": true,
};
const ENTRY_PREFIXES = ["tsconfig", "readme", "vite.config", "playwright.config", "vitest.config", "eslint.config", ".env"];
const ENTRY_NAMES = /^(index|main|app|mod|conftest)\.[cm]?[tj]sx?$/;

/** Farbgruppe eines Pfads — eine Quelle der Wahrheit für Hub und PWA. */
export function graphGroupOf(path: string): GraphGroup {
  const lower = path.toLowerCase();
  const name = lower.slice(lower.lastIndexOf("/") + 1);
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  if (CONFIG_NAMES[name] || name.startsWith(".env")) return "config";
  if (ext in CONFIG_EXT) return "config";
  if (ext in DOC_EXT) return "doc";
  if (ext in CODE_EXT) return "code";
  return "other";
}

/** Einstiegspunkt-Heuristik (ADR-0062): Dateien, die ohne Zufluss nicht „tot“ sind. */
export function isGraphEntry(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (name in ENTRY_FILES) return true;
  if (ENTRY_NAMES.test(name)) return true;
  return ENTRY_PREFIXES.some((p) => name.startsWith(p));
}
