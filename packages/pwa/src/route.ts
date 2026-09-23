/** Hash routes for the same session after reload (AC-P5-5), per host (EPIC-P6). */
export function sessionHash(sessionId: string, hostId?: string | null): string {
  const session = `sessions/${encodeURIComponent(sessionId)}`;
  return hostId ? `#/hosts/${encodeURIComponent(hostId)}/${session}` : `#/${session}`;
}

export type AppRoute = { view: "list" } | { view: "tail"; sessionId: string; hostId?: string };

export function parseAppHash(hash: string): AppRoute {
  const hosted = /^#\/hosts\/([^/?#]+)\/sessions\/([^/?#]+)$/.exec(hash);
  if (hosted?.[1] && hosted[2]) {
    return { view: "tail", hostId: decodeURIComponent(hosted[1]), sessionId: decodeURIComponent(hosted[2]) };
  }
  const match = /^#\/sessions\/([^/?#]+)$/.exec(hash);
  const raw = match?.[1];
  if (!raw) return { view: "list" };
  return { view: "tail", sessionId: decodeURIComponent(raw) };
}
