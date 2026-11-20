import type { NormalizedEvent } from "../../shared/ws.ts";

export function backgroundActivities(events: readonly NormalizedEvent[]) {
  const active = new Map<string, { id: string; label: string; startedAt: string }>();
  for (const { ts, payload } of events) {
    const { kind, id, label, startedAt } = payload;
    if (typeof id !== "string" || id.startsWith("tool:")) continue;
    if (kind === "session.activity_begin") {
      active.set(id, {
        id,
        label: typeof label === "string" ? label : id,
        startedAt: typeof startedAt === "string" ? startedAt : ts,
      });
    } else if (kind === "session.activity_end") active.delete(id);
  }
  return [...active.values()];
}
