import type { FleetHost, SessionRecord } from "../../shared/api.ts";

/** Session counts for the status bar. Archived sessions are not "in the system" any more. */
export interface SessionCounts {
  working: number;
  waiting: number;
  error: number;
  idle: number;
}

export function countSessions(sessions: readonly SessionRecord[]): SessionCounts {
  const counts: SessionCounts = { working: 0, waiting: 0, error: 0, idle: 0 };
  for (const s of sessions) {
    if (s.archived) continue;
    if (s.status === "working" || s.status === "starting") counts.working += 1;
    else if (s.status === "waiting_approval") counts.waiting += 1;
    else if (s.status === "error") counts.error += 1;
    else if (s.status === "idle") counts.idle += 1;
  }
  return counts;
}

/** Fleet in one phrase: nothing but this hub reads as "lokal". */
export function fleetSummary(hosts: readonly FleetHost[]): { text: string; problem: boolean } {
  const remote = hosts.filter((h) => !h.self);
  if (remote.length === 0) return { text: "lokal", problem: false };
  const bad = remote.filter((h) => h.state !== "reachable");
  return bad.length === 0 ? { text: `${remote.length + 1} Hosts`, problem: false } : { text: `${bad.length} von ${remote.length} Hosts gestört`, problem: true };
}

/** "14:05:12" — when the last good poll was; the bar shows it while the hub is unreachable. */
export function clockText(at: number | null): string {
  return at === null ? "nie" : new Date(at).toLocaleTimeString("de-DE");
}
