import { describe, expect, it } from "vitest";
import { lastAssistantQuestion } from "../../../src/features/session/QuickConfirm.tsx";
import type { NormalizedEvent } from "../../../src/shared/ws.ts";

function ev(type: string, payload: Record<string, unknown>, summary = ""): NormalizedEvent {
  return { seq: 1, ts: "2026-10-28T00:00:00Z", sessionId: "s", type, summary, payload, blobRef: null };
}

describe("lastAssistantQuestion (Ja/Nein-Rückfragen)", () => {
  it("endet die letzte Assistant-Nachricht auf „?“, liegt eine Frage vor", () => {
    expect(lastAssistantQuestion([ev("user", { text: "mach" }), ev("assistant", { text: "Soll ich committen? " })])).toBe("Soll ich committen?");
  });

  it("payload.text gewinnt über die gekürzte summary", () => {
    const long = `${"x".repeat(300)} weiter?`;
    expect(lastAssistantQuestion([ev("assistant", { text: long }, long.slice(0, 200))])).toBe(long);
  });

  it("kein Fragezeichen: keine Frage — auch nicht mitten im Text", () => {
    expect(lastAssistantQuestion([ev("assistant", { text: "Wie gesagt? Nein, erledigt." })])).toBeNull();
  });

  it("Assistant ohne Text nutzt die summary; system/tool Events zählen nicht", () => {
    expect(lastAssistantQuestion([ev("assistant", {}, "Fertig. Noch etwas?")])).toBe("Fertig. Noch etwas?");
    expect(lastAssistantQuestion([ev("tool_result", { text: "Fehler?" })])).toBeNull();
  });

  it("eine spätere Nicht-Frage-Antwort überdeckt die frühere Frage", () => {
    expect(lastAssistantQuestion([ev("assistant", { text: "Weiter?" }), ev("assistant", { text: "Alles fertig." })])).toBeNull();
  });
});
