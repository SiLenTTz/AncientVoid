import { describe, expect, it } from "vitest";
import { displayLabel, displayState, needsYou, overallState } from "../../src/shared/display-state.ts";

describe("Anzeigezustand (EPIC-P43 T43.2, §3.3)", () => {
  it("leitet jeden Hub-Status ab", () => {
    expect(displayState({ status: "starting" })).toBe("working");
    expect(displayState({ status: "working" })).toBe("working");
    expect(displayState({ status: "stopping" })).toBe("working");
    expect(displayState({ status: "waiting_approval" })).toBe("approval");
    expect(displayState({ status: "error" })).toBe("error");
    expect(displayState({ status: "interrupted" })).toBe("error");
    expect(displayState({ status: "idle" })).toBe("quiet");
    expect(displayState({ status: "parked" })).toBe("quiet");
    expect(displayState({ status: "stopped" })).toBe("quiet");
  });

  it("„Frage“ ist Freigabe-Status plus offene Rückfrage — sonst nie", () => {
    expect(displayState({ status: "waiting_approval", question: true })).toBe("question");
    expect(displayState({ status: "working", question: true })).toBe("working");
    expect(displayState({ status: "idle", question: true })).toBe("quiet");
  });

  it("ein beendeter Zug ruft nur, solange ihn hier niemand gesehen hat", () => {
    expect(displayState({ status: "idle", unseen: true })).toBe("done");
    expect(displayState({ status: "idle", unseen: false })).toBe("quiet");
    // Ungelesenes ändert nichts an Zuständen, die schon mehr sagen.
    expect(displayState({ status: "working", unseen: true })).toBe("working");
    expect(displayState({ status: "stopped", unseen: true })).toBe("quiet");
  });

  it("ein unbekannter Status wird nicht ruhig dargestellt (fail loud)", () => {
    expect(displayState({ status: "quantum" })).toBe("error");
    expect(displayLabel({ status: "quantum" })).toBe("quantum");
  });

  it("Worte: Hub-Status, außer bei Frage und fertigem Zug", () => {
    expect(displayLabel({ status: "waiting_approval" })).toBe("Freigabe nötig");
    expect(displayLabel({ status: "waiting_approval", question: true })).toBe("Frage");
    expect(displayLabel({ status: "idle", unseen: true })).toBe("fertig");
    expect(displayLabel({ status: "idle" })).toBe("bereit");
    expect(displayLabel({ status: "interrupted" })).toBe("unterbrochen");
  });

  it("„du bist dran“ gilt für Freigabe, Frage, fertigen Zug und Fehler", () => {
    expect((["working", "approval", "question", "done", "error", "quiet"] as const).filter(needsYou)).toEqual(["approval", "question", "done", "error"]);
  });

  it("Gesamtzustand: Freigabe > Frage > Fehler > arbeitet > fertig > ruhig", () => {
    expect(overallState([])).toBe("quiet");
    expect(overallState(["quiet", "working", "done"])).toBe("working");
    expect(overallState(["working", "error"])).toBe("error");
    expect(overallState(["error", "question"])).toBe("question");
    expect(overallState(["question", "approval", "working"])).toBe("approval");
    expect(overallState(["done", "quiet"])).toBe("done");
  });
});
