import type { SessionRecord } from "../../shared/api.ts";

/** Overview hides archived runs. The Archiv chip shows only those. */
export function sessionsForOverview(sessions: readonly SessionRecord[], showArchived: boolean): SessionRecord[] {
  return sessions.filter((session) => (showArchived ? session.archived === true : session.archived !== true));
}

/** EPIC-P15 T15.6: when a session last did something a person would call activity. */
export function lastActivityAt(session: Pick<SessionRecord, "lastActivity" | "updatedAt">): string {
  return session.lastActivity?.at ?? session.updatedAt;
}

/** Newest activity first. `updatedAt` also moves on archiving or switching the mode, so it is only the fallback. */
export function compareByActivity(a: Pick<SessionRecord, "lastActivity" | "updatedAt">, b: Pick<SessionRecord, "lastActivity" | "updatedAt">): number {
  const x = lastActivityAt(a);
  const y = lastActivityAt(b);
  return x < y ? 1 : x > y ? -1 : 0;
}

/** An idle session untouched for this long no longer counts as "aktiv". */
export const IDLE_STILL_ACTIVE_MS = 12 * 60 * 60_000;
