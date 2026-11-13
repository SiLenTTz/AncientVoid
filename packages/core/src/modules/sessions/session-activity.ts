import { EXTERNAL_ACTIVITY_TTL_MS, SessionActivity, type Ack, type NormalizedEvent } from "@ancientvoid/contracts";
import type { LiveSession, OpenActivity } from "./session-state.ts";

interface Host {
  session(id: string): LiveSession | undefined;
  emit(session: LiveSession, kind: string, payload: Record<string, unknown>): Promise<void>;
  working(session: LiveSession): Promise<void>;
  finish(session: LiveSession): Promise<void>;
}

/** Provider work and explicitly registered jobs share a journal, not an OS heuristic. */
export class SessionActivities {
  private readonly host: Host;
  constructor(host: Host) { this.host = host; }

  async record(session: LiveSession, raw: SessionActivity, external: boolean): Promise<void> {
    const activity = SessionActivity.parse(raw);
    const open = session.activities ??= new Map();
    const key = `${external ? "external" : "provider"}:${activity.id}`;
    if (activity.state === "running") open.set(key, { activity, external, updatedAt: new Date().toISOString() });
    else open.delete(key);
    if (external && activity.state === "failed") session.turnFailed = true;
    await this.host.emit(session, "session.activity", { activity, external, openCount: open.size });
    if (activity.state === "running" && session.record.status === "idle") await this.host.working(session);
    if (session.mainTurnIdle && !open.size) await this.host.finish(session);
  }

  async report(sessionId: string, activity: SessionActivity): Promise<Ack> {
    const session = this.host.session(sessionId);
    const allowed = session && (["working", "idle", "waiting_approval"].includes(session.record.status) || activity.state !== "running");
    if (!session || !allowed) return { ok: false, detail: "Session nimmt keine Hintergrundarbeit an." };
    const run = (session.lifecycle ?? Promise.resolve()).then(() => this.record(session, activity, true));
    session.lifecycle = run;
    await run;
    return { ok: true };
  }

  async expire(session: LiveSession): Promise<void> {
    for (const work of [...(session.activities?.values() ?? [])]) {
      if (work.external && Date.now() - Date.parse(work.updatedAt) > EXTERNAL_ACTIVITY_TTL_MS) {
        await this.record(session, { ...work.activity, state: "failed" }, true);
        await this.host.emit(session, "session.recovery_blocked", { detail: `Hintergrundarbeit „${work.activity.label ?? work.activity.id}“ meldet sich nicht mehr. Zustand prüfen, abbrechen oder übergeben.` });
      }
    }
  }
}

/** The journal also records invalidation when a dead provider is replaced. */
export function foldActivities(events: readonly NormalizedEvent[]): Map<string, OpenActivity> {
  const open = new Map<string, OpenActivity>();
  for (const event of events) {
    if (event.payload.kind === "session.activities_reset") {
      for (const [id, work] of open) if (!work.external) open.delete(id);
    }
    if (event.payload.kind !== "session.activity") continue;
    const parsed = SessionActivity.safeParse(event.payload.activity);
    if (!parsed.success) continue;
    const external = event.payload.external === true;
    const key = `${external ? "external" : "provider"}:${parsed.data.id}`;
    if (parsed.data.state === "running") open.set(key, { activity: parsed.data, external, updatedAt: event.ts });
    else open.delete(key);
  }
  return open;
}
