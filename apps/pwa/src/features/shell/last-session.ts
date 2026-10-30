/**
 * EPIC-P23 T23.1: the session a person worked in last, per device. "AncientVoid" leads to the overview and
 * this session is marked there. A session that no longer exists simply marks nothing.
 */
const KEY = "uacc.lastSession";

export interface LastSession {
  sessionId: string;
  /** Only set for a session of another host of the fleet. */
  hostId?: string;
}

export function getLastSession(): LastSession | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as { sessionId?: unknown; hostId?: unknown } | null;
    if (!raw || typeof raw.sessionId !== "string" || !raw.sessionId) return null;
    return typeof raw.hostId === "string" && raw.hostId ? { sessionId: raw.sessionId, hostId: raw.hostId } : { sessionId: raw.sessionId };
  } catch {
    return null;
  }
}

export function rememberSession(ref: LastSession | null): void {
  if (!ref) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(ref.hostId ? { sessionId: ref.sessionId, hostId: ref.hostId } : { sessionId: ref.sessionId }));
  } catch {
    // private window / quota: the marker is a convenience, never a reason to fail an open
  }
}

/** Whether `session` is the remembered one. `remoteHostId` is the session's host as the UI knows it (null = this hub). */
export function isLastSession(ref: LastSession | null, sessionId: string, remoteHostId: string | null): boolean {
  return ref !== null && ref.sessionId === sessionId && (ref.hostId ?? null) === remoteHostId;
}
