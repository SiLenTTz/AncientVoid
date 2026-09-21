/** Hash routes for the same session after reload (AC-P5-5). */
export function sessionHash(sessionId: string): string {
  return `#/sessions/${encodeURIComponent(sessionId)}`;
}

export function parseAppHash(hash: string): { view: "list" } | { view: "tail"; sessionId: string } {
  const match = /^#\/sessions\/([^/?#]+)$/.exec(hash);
  const raw = match?.[1];
  if (!raw) return { view: "list" };
  return { view: "tail", sessionId: decodeURIComponent(raw) };
}
