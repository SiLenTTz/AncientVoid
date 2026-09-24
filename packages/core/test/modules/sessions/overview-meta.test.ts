import { describe, expect, it } from "vitest";
import { activityOf } from "../../../src/modules/sessions/session-state.ts";

const ev = (type: string, summary: string, payload: Record<string, unknown> = {}) => ({ type: type as never, summary, payload, ts: "2026-09-24T10:00:00.000Z" });

describe("last activity for the card (T8.1)", () => {
  it("says in words what happened last", () => {
    expect(activityOf(ev("assistant", "x", { text: "Ich habe\n  die Tests\n repariert." }))?.text).toBe("Ich habe die Tests repariert.");
    expect(activityOf(ev("tool_use", "Bash: npm test"))?.text).toBe("Werkzeug: Bash: npm test");
    expect(activityOf(ev("gate", "Bash: rm -rf dist", { kind: "tool.permission_requested" }))?.text).toBe("Wartet auf Freigabe: Bash: rm -rf dist");
    expect(activityOf(ev("system", "provider.error", { kind: "provider.error", title: "Limit erreicht" }))?.text).toBe("Fehler: Limit erreicht");
    expect(activityOf(ev("system", "session.turn_end", { kind: "session.turn_end" }))?.text).toBe("Zug beendet — wartet auf dich");
    expect(activityOf(ev("user", "Mach weiter"))).toMatchObject({ text: "Du: Mach weiter", type: "user", at: "2026-09-24T10:00:00.000Z" });
  });

  it("ignores internal noise and keeps it short", () => {
    expect(activityOf(ev("system", "claude · Session x", { kind: "claude.native_session" }))).toBeNull();
    expect(activityOf(ev("tool_result", "ok"))).toBeNull();
    expect(activityOf(ev("assistant", "", { text: "a".repeat(400) }))!.text.length).toBeLessThanOrEqual(140);
  });
});
