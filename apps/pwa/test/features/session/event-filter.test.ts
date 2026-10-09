import { describe, expect, it } from "vitest";
import type { NormalizedEvent } from "../../../src/shared/ws.ts";
import { isEmptyThinking, showInChat } from "../../../src/features/session/event-filter.ts";
import { visibleEventText } from "../../../src/features/session/event-text.ts";

function event(partial: Partial<NormalizedEvent> & Pick<NormalizedEvent, "type" | "summary">): NormalizedEvent {
  return {
    seq: 1,
    ts: "2026-09-26T00:00:00.000Z",
    sessionId: "s",
    blobRef: null,
    payload: {},
    ...partial,
  };
}

describe("showInChat (BUG-0033: gleiche Marker für ACP wie für CLI-Adapter)", () => {
  it("shows the model marker from both adapter families", () => {
    expect(showInChat(event({ type: "system", summary: "opencode · m1", payload: { kind: "opencode.model" } }))).toBe(true);
    expect(showInChat(event({ type: "system", summary: "acp · m1", payload: { kind: "acp.model" } }))).toBe(true);
  });

  it("shows a refused steer, never an accepted one; a queued message shows its wait marker", () => {
    expect(showInChat(event({ type: "system", summary: "session.steer", payload: { kind: "session.steer", steerKind: "prompt", ok: false, detail: "acp: der Zug läuft noch" } }))).toBe(true);
    expect(showInChat(event({ type: "system", summary: "session.steer", payload: { kind: "session.steer", steerKind: "prompt", ok: true } }))).toBe(false);
    expect(showInChat(event({ type: "system", summary: "ACP-Agent: Nachricht wartet bis der Zug endet", payload: { kind: "acp.queued", queued: 1 } }))).toBe(true);
  });

  it("keeps hiding unrelated system events", () => {
    expect(showInChat(event({ type: "system", summary: "session.steer", payload: { kind: "session.turn_end" } }))).toBe(false);
    expect(showInChat(event({ type: "gate", summary: "Shell: ls" }))).toBe(false);
  });
});

describe("visibleEventText (BUG-0033)", () => {
  it("a refused steer becomes a sentence, not the raw kind string", () => {
    const shown = visibleEventText(event({ type: "system", summary: "session.steer", payload: { kind: "session.steer", steerKind: "prompt", ok: false, detail: "acp: der Zug läuft noch — erst anhalten oder abwarten" } }));
    expect(shown).toBe("Nicht zugestellt: acp: der Zug läuft noch — erst anhalten oder abwarten");
  });

  it("without a detail it still says what happened", () => {
    const shown = visibleEventText(event({ type: "system", summary: "session.steer", payload: { kind: "session.steer", steerKind: "prompt", ok: false } }));
    expect(shown).toBe("Nicht zugestellt");
  });
});

describe("BUG-0046: Denk-Blöcke ohne Text", () => {
  it("ein leerer Denk-Block ist kein Chat-Inhalt, einer mit Text schon", () => {
    expect(showInChat(event({ type: "thinking", summary: "(thinking)", payload: { text: "" } }))).toBe(false);
    expect(showInChat(event({ type: "thinking", summary: "Claude hat nachgedacht", payload: { text: "", redacted: true } }))).toBe(false);
    expect(showInChat(event({ type: "thinking", summary: "Rechne 17*23", payload: { text: "Rechne 17*23" } }))).toBe(true);
  });

  it("isEmptyThinking erkennt auch ältere gespeicherte Events ohne redacted-Flag", () => {
    expect(isEmptyThinking(event({ type: "thinking", summary: "(thinking)", payload: { text: "" } }))).toBe(true);
    expect(isEmptyThinking(event({ type: "thinking", summary: "x", payload: {} }))).toBe(true);
    expect(isEmptyThinking(event({ type: "thinking", summary: "x", payload: { text: "da" } }))).toBe(false);
    expect(isEmptyThinking(event({ type: "assistant", summary: "x", payload: { text: "" } }))).toBe(false);
  });
});
