/** Hash routes for the same session after reload (AC-P5-5), per host (EPIC-P6). */
export function sessionHash(sessionId: string, hostId?: string | null): string {
  const session = `sessions/${encodeURIComponent(sessionId)}`;
  return hostId ? `#/hosts/${encodeURIComponent(hostId)}/${session}` : `#/${session}`;
}

/** T7.6: a line in a session's worktree — `…/code/<path>:L<line>`. */
export function codeHash(sessionId: string, path: string, line: number | null, hostId?: string | null): string {
  return `${sessionHash(sessionId, hostId)}/code/${path.split("/").map(encodeURIComponent).join("/")}${line ? `:L${line}` : ""}`;
}

/** EPIC-P48: Repo-Graph der Session im Chat-Fenster — `…/graph`. */
export function graphHash(sessionId: string, hostId?: string | null): string {
  return `${sessionHash(sessionId, hostId)}/graph`;
}

/** EPIC-P48: eine Datei der Session im Datei-Tab des Chat-Fensters — `…/datei/<path>`. */
export function fileHash(sessionId: string, path: string, hostId?: string | null): string {
  return `${sessionHash(sessionId, hostId)}/datei/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export interface CodeTarget {
  path: string;
  line: number | null;
}

/** Tabs, die eine eigene Hash-Route haben (EPIC-P48) — `datei` trägt den Pfad in `file`. */
export type TailTab = "graph" | "datei";

/** T8.1: every page has a URL, so Back in the browser goes back. */
export type ListPage = "dashboard" | "new" | "settings" | "approvals" | "status" | "discovery" | "media" | "pc";
const PAGE_SLUG: Record<ListPage, string> = { dashboard: "", new: "neu", settings: "einstellungen", approvals: "freigaben", status: "status", discovery: "gefunden", media: "medien", pc: "pc" };

/** EPIC-P34 T34.2: Seiten, die am Desktop die Detailspalte füllen. Übersicht, Neu und Freigaben bleiben in der Liste (K1-Weg). */
export const TOOL_PAGE_IDS = ["settings", "discovery", "media", "pc", "status"] as const;
export type ToolPageId = (typeof TOOL_PAGE_IDS)[number];
const TOOL_PAGES: ReadonlySet<ListPage> = new Set<ListPage>(TOOL_PAGE_IDS);

export function isToolPage(page: ListPage): page is ToolPageId {
  return TOOL_PAGES.has(page);
}

export function pageHash(page: ListPage): string {
  return `#/${PAGE_SLUG[page]}`;
}

export type AppRoute =
  | { view: "list"; page: ListPage }
  | { view: "tail"; sessionId: string; hostId?: string; code?: CodeTarget; tab?: TailTab; file?: string };

function codeTarget(raw: string | undefined): CodeTarget | undefined {
  if (!raw) return undefined;
  const m = /^(.+?)(?::L(\d+))?$/.exec(raw);
  if (!m?.[1]) return undefined;
  const path = m[1].split("/").map(decodeURIComponent).join("/");
  return { path, line: m[2] ? Number(m[2]) : null };
}

function fileTarget(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return raw.split("/").map(decodeURIComponent).join("/");
}

export function parseAppHash(hash: string): AppRoute {
  const slug = /^#\/([a-z]*)\/?$/.exec(hash || "#/")?.[1];
  if (slug !== undefined) {
    const page = (Object.keys(PAGE_SLUG) as ListPage[]).find((p) => PAGE_SLUG[p] === slug);
    return { view: "list", page: page ?? "dashboard" };
  }
  const hosted = /^#\/hosts\/([^/?#]+)\/sessions\/([^/?#]+)(?:\/code\/(.+))?(?:\/(graph|datei)(?:\/(.+))?)?$/.exec(hash);
  if (hosted?.[1] && hosted[2]) {
    const code = codeTarget(hosted[3]);
    const file = hosted[4] === "datei" ? fileTarget(hosted[5]) : undefined;
    return {
      view: "tail",
      hostId: decodeURIComponent(hosted[1]),
      sessionId: decodeURIComponent(hosted[2]),
      ...(code ? { code } : {}),
      ...(hosted[4] === "graph" ? { tab: "graph" as const } : {}),
      ...(file !== undefined ? { tab: "datei" as const, file } : {}),
    };
  }
  const match = /^#\/sessions\/([^/?#]+)(?:\/code\/(.+))?(?:\/(graph|datei)(?:\/(.+))?)?$/.exec(hash);
  const raw = match?.[1];
  if (!raw) return { view: "list", page: "dashboard" };
  const code = codeTarget(match[2]);
  const file = match[3] === "datei" ? fileTarget(match[4]) : undefined;
  return {
    view: "tail",
    sessionId: decodeURIComponent(raw),
    ...(code ? { code } : {}),
    ...(match[3] === "graph" ? { tab: "graph" as const } : {}),
    ...(file !== undefined ? { tab: "datei" as const, file } : {}),
  };
}
