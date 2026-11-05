import { describe, expect, it } from "vitest";
import type { SessionRecord } from "../../src/shared/api.ts";
import { compareByActivity, IDLE_STILL_ACTIVE_MS, lastActivityAt } from "../../src/features/overview/session-list.ts";
import { sectionOf } from "../../src/features/overview/Dashboard.tsx";

const NOW = Date.parse("2026-10-09T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const session = (over: Partial<SessionRecord>): SessionRecord =>
  ({ id: "s", status: "idle", updatedAt: ago(0), lastActivity: null, pinned: false, ...over }) as SessionRecord;

describe("EPIC-P15 T15.6: relevante Sessions zuerst", () => {
  it("läuft etwas, ist es aktiv — egal wie lange schon", () => {
    expect(sectionOf(session({ status: "working", lastActivity: { text: "x", type: "tool_use", at: ago(48 * 3600_000) } }), NOW)).toBe("aktiv");
    expect(sectionOf(session({ status: "starting" }), NOW)).toBe("aktiv");
  });

  it("eine frische Leerlauf-Session bleibt aktiv, eine lange unberührte wandert nach „Zuletzt“", () => {
    expect(sectionOf(session({ lastActivity: { text: "x", type: "assistant", at: ago(IDLE_STILL_ACTIVE_MS - 60_000) } }), NOW)).toBe("aktiv");
    expect(sectionOf(session({ lastActivity: { text: "x", type: "assistant", at: ago(IDLE_STILL_ACTIVE_MS + 60_000) } }), NOW)).toBe("zuletzt");
  });

  it("was dich braucht und was angeheftet ist, bleibt oben — auch wenn es alt ist", () => {
    const old = { lastActivity: { text: "x", type: "assistant", at: ago(10 * 24 * 3600_000) } };
    expect(sectionOf(session({ ...old, status: "waiting_approval" }), NOW)).toBe("braucht");
    expect(sectionOf(session({ ...old, status: "error" }), NOW)).toBe("braucht");
    expect(sectionOf(session({ ...old, status: "interrupted" }), NOW)).toBe("braucht");
    expect(sectionOf(session({ ...old, pinned: true }), NOW)).toBe("pins");
  });

  it("beendete Sessions sind „Zuletzt“", () => {
    expect(sectionOf(session({ status: "stopped" }), NOW)).toBe("zuletzt");
  });

  it("sortiert nach letzter Aktivität; updatedAt (Archivieren, Modus) schiebt nichts nach oben", () => {
    const touched = session({ id: "a", updatedAt: ago(0), lastActivity: { text: "x", type: "assistant", at: ago(5 * 3600_000) } });
    const recent = session({ id: "b", updatedAt: ago(3600_000), lastActivity: { text: "x", type: "assistant", at: ago(3600_000) } });
    const noActivity = session({ id: "c", updatedAt: ago(10 * 3600_000), lastActivity: null });
    expect([touched, noActivity, recent].sort(compareByActivity).map((s) => s.id)).toEqual(["b", "a", "c"]);
    expect(lastActivityAt(noActivity)).toBe(noActivity.updatedAt);
  });
});
