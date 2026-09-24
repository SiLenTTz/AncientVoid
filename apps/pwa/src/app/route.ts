/** Hash routes for the same session after reload (AC-P5-5), per host (EPIC-P6). */
export function sessionHash(sessionId: string, hostId?: string | null): string {
  const session = `sessions/${encodeURIComponent(sessionId)}`;
  return hostId ? `#/hosts/${encodeURIComponent(hostId)}/${session}` : `#/${session}`;
}

/** T7.6: a line in a session's worktree — `…/code/<path>:L<line>`. */
export function codeHash(sessionId: string, path: string, line: number | null, hostId?: string | null): string {
  return `${sessionHash(sessionId, hostId)}/code/${path.split("/").map(encodeURIComponent).join("/")}${line ? `:L${line}` : ""}`;
}

export interface CodeTarget {
  path: string;
  line: number | null;
}

export type AppRoute = { view: "list" } | { view: "tail"; sessionId: string; hostId?: string; code?: CodeTarget };

function codeTarget(raw: string | undefined): CodeTarget | undefined {
  if (!raw) return undefined;
  const m = /^(.+?)(?::L(\d+))?$/.exec(raw);
  if (!m?.[1]) return undefined;
  const path = m[1].split("/").map(decodeURIComponent).join("/");
  return { path, line: m[2] ? Number(m[2]) : null };
}

export function parseAppHash(hash: string): AppRoute {
  const hosted = /^#\/hosts\/([^/?#]+)\/sessions\/([^/?#]+)(?:\/code\/(.+))?$/.exec(hash);
  if (hosted?.[1] && hosted[2]) {
    const code = codeTarget(hosted[3]);
    return { view: "tail", hostId: decodeURIComponent(hosted[1]), sessionId: decodeURIComponent(hosted[2]), ...(code ? { code } : {}) };
  }
  const match = /^#\/sessions\/([^/?#]+)(?:\/code\/(.+))?$/.exec(hash);
  const raw = match?.[1];
  if (!raw) return { view: "list" };
  const code = codeTarget(match[2]);
  return { view: "tail", sessionId: decodeURIComponent(raw), ...(code ? { code } : {}) };
}
