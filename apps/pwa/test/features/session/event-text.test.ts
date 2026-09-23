import { describe, expect, it } from "vitest";
import type { NormalizedEvent } from "../../../src/shared/ws.ts";
import { visibleEventText } from "../../../src/features/session/event-text.ts";
import { sessionsForOverview } from "../../../src/features/overview/session-list.ts";
import type { SessionRecord } from "../../../src/shared/api.ts";

function event(partial: Partial<NormalizedEvent> & Pick<NormalizedEvent, "type" | "summary">): NormalizedEvent {
  return {
    seq: 1,
    ts: "2026-09-22T00:00:00.000Z",
    sessionId: "s",
    blobRef: null,
    payload: {},
    ...partial,
  };
}

describe("visibleEventText", () => {
  it("shows the full assistant text instead of the 200-character summary", () => {
    const text = `${"https://omarchy.tail6d2826.ts.net:8443\n".repeat(20)}Spiel im Browser öffnen`;
    const shown = visibleEventText(
      event({
        type: "assistant",
        summary: text.slice(0, 199) + "…",
        payload: { text },
      }),
    );
    expect(shown).toBe(text);
    expect(shown).toContain("Spiel im Browser öffnen");
  });

  it("keeps the summary for events that have no text payload", () => {
    expect(visibleEventText(event({ type: "tool_use", summary: "Bash(ls)" }))).toBe("Bash(ls)");
  });
});

describe("sessionsForOverview", () => {
  const active = { id: "a", archived: false } as SessionRecord;
  const archived = { id: "b", archived: true } as SessionRecord;

  it("hides archived sessions until the archive chip is on", () => {
    expect(sessionsForOverview([active, archived], false).map((s) => s.id)).toEqual(["a"]);
    expect(sessionsForOverview([active, archived], true).map((s) => s.id)).toEqual(["b"]);
  });
});
