import type { SessionRecord } from "../../shared/api.ts";

/** Overview hides archived runs. The Archiv chip shows only those. */
export function sessionsForOverview(sessions: readonly SessionRecord[], showArchived: boolean): SessionRecord[] {
  return sessions.filter((session) => (showArchived ? session.archived === true : session.archived !== true));
}
