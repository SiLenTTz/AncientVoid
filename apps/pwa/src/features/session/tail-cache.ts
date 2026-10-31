import type { NormalizedEvent } from "../../shared/ws.ts";

/**
 * T8.2 (K10): the last events of the last few sessions, on this device —
 * so an opened session still reads offline. Shown only until live events
 * arrive, always with the time they are from.
 */
const INDEX = "ancientvoid.tail.index";
const KEEP_SESSIONS = 10;
const KEEP_EVENTS = 150;

export interface CachedTail {
  at: string;
  events: NormalizedEvent[];
}

const key = (hostKey: string, id: string) => `ancientvoid.tail.${hostKey}.${id}`;

export function loadTail(hostKey: string, id: string): CachedTail | null {
  try {
    const v = JSON.parse(localStorage.getItem(key(hostKey, id)) ?? "null") as CachedTail | null;
    return v && Array.isArray(v.events) ? v : null;
  } catch {
    return null;
  }
}

export function saveTail(hostKey: string, id: string, events: NormalizedEvent[]): void {
  if (events.length === 0) return;
  const k = key(hostKey, id);
  try {
    const index = (JSON.parse(localStorage.getItem(INDEX) ?? "[]") as string[]).filter((x) => x !== k);
    index.unshift(k);
    for (const old of index.splice(KEEP_SESSIONS)) localStorage.removeItem(old);
    localStorage.setItem(INDEX, JSON.stringify(index));
    localStorage.setItem(k, JSON.stringify({ at: new Date().toISOString(), events: events.slice(-KEEP_EVENTS) }));
  } catch {
    // Storage full: offline reading is a bonus, never an error.
  }
}
