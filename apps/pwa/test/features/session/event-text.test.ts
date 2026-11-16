import { describe, expect, it } from "vitest";
import type { NormalizedEvent } from "../../../src/shared/ws.ts";
import { isOffloaded, visibleEventText, withBlobPayload } from "../../../src/features/session/event-text.ts";
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
    const text = `${"https://workstation.tailnet-example.ts.net:8443\n".repeat(20)}Spiel im Browser öffnen`;
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

describe("ausgelagerte Payloads (BUG-0068)", () => {
  const text = `${"Absatz mit Inhalt. ".repeat(300)}ENDE`;
  const offloaded = event({
    type: "assistant",
    summary: text.slice(0, 199) + "…",
    blobRef: "sha256:abc",
    payload: { truncated: true, bytes: text.length + 11, preview: JSON.stringify({ text }).slice(0, 256) },
  });

  it("erkennt ein vom EventStore ausgelagertes Payload", () => {
    expect(isOffloaded(offloaded)).toBe(true);
    // An adapter's own blob (raw stdout etc.) is not the payload.
    expect(isOffloaded(event({ type: "tool_result", summary: "x", blobRef: "sha256:def", payload: { content: "x" } }))).toBe(false);
  });

  it("mit dem geladenen Blob zeigt der Chat den ganzen Text, nicht die 200-Zeichen-Zusammenfassung", () => {
    const full = withBlobPayload(offloaded, JSON.stringify({ text }));
    expect(visibleEventText(full)).toBe(text);
    expect(visibleEventText(full).endsWith("ENDE")).toBe(true);
  });

  it("ein Blob, der kein Payload-Objekt ist, ändert nichts", () => {
    expect(withBlobPayload(offloaded, "kein json")).toBe(offloaded);
    expect(withBlobPayload(offloaded, "[1,2]")).toBe(offloaded);
  });
});
