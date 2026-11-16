/**
 * T8.6: "new since your last visit" — a read cursor per device and
 * session (last event seq seen here). Per device on purpose: the phone
 * has not read what the PC showed.
 */
const KEY = "ancientvoid.seen";

type SeenMap = Record<string, number>;

function read(): SeenMap | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null") as SeenMap | null;
  } catch {
    return null;
  }
}

export const seenKey = (hostKey: string, sessionId: string) => `${hostKey}:${sessionId}`;

/** First run on this device: everything that exists counts as seen. */
export function initSeen(sessions: { key: string; lastSeq: number }[]): void {
  if (read() !== null) return;
  localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(sessions.map((s) => [s.key, s.lastSeq]))));
}

export function getSeen(key: string): number | null {
  const v = read()?.[key];
  return typeof v === "number" ? v : null;
}

export function markSeen(key: string, seq: number): void {
  const map = read() ?? {};
  if ((map[key] ?? -1) >= seq) return;
  map[key] = seq;
  const entries = Object.entries(map);
  // Keep it small: the 300 most recently written sessions.
  localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries.slice(-300))));
}

/** A session with events this device has not seen (never opened = new). */
export function isUnseen(key: string, lastSeq: number): boolean {
  const seen = getSeen(key);
  return lastSeq > (seen ?? 0);
}
