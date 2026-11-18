import { describe, expect, it } from "vitest";
import { SECTION_KEYS, defaultExpanded, sectionOf, unseenBySection, type SectionItem } from "../../../src/features/notifications/sections.ts";

/** Nutzerwunsch 2026-11-18: Abschnitte des Benachrichtigungs-Panels einklappbar —
 * Vorgabe: nur Abschnitte mit noch ungesehenen Meldungen stehen offen. */
function item(o: Partial<SectionItem> & { id: number }): SectionItem {
  return { hostId: null, sessionId: null, level: "info", kind: "session.info", ...o };
}

describe("sectionOf — Einteilung wie das Panel (Fehler, offene Fragen, Rest)", () => {
  it("Fehler-Level geht vor alles in den Fehler-Abschnitt", () => {
    expect(sectionOf(item({ id: 1, level: "error" }), new Set())).toBe("errors");
  });

  it("Freigabe-Frage mit live offener Freigabe → questions — auch neben Fehlern anderer", () => {
    expect(sectionOf(item({ id: 2, kind: "tool.permission_requested", sessionId: "s1" }), new Set(["#s1"]))).toBe("questions");
    expect(sectionOf(item({ id: 3, hostId: "peer", kind: "session.steer_pending_approval", sessionId: "s2" }), new Set(["peer#s2"]))).toBe("questions");
  });

  it("beantwortete Frage (nicht mehr pending) → rest", () => {
    expect(sectionOf(item({ id: 4, kind: "tool.permission_requested", sessionId: "s1" }), new Set())).toBe("rest");
  });

  it("Fehler-Level schlägt offene Frage (Panelsortierung: Fehler zuerst)", () => {
    expect(sectionOf(item({ id: 5, level: "error", kind: "tool.permission_requested", sessionId: "s1" }), new Set(["#s1"]))).toBe("errors");
  });
});

describe("unseenBySection — Ungesehenes je Abschnitt (Read-Mark je Host)", () => {
  it("alles ungesehen: jeder Abschnitt zählt", () => {
    const items = [
      item({ id: 7, level: "error" }),
      item({ id: 6, kind: "tool.permission_requested", sessionId: "s1" }),
      item({ id: 5, kind: "session.turn_end", level: "success" }),
    ];
    expect(unseenBySection(items, {}, new Set(["#s1"]))).toEqual({ errors: 1, questions: 1, rest: 1 });
  });

  it("Read-Mark deckt alles → Vorgabe wäre überall zugeklappt (0 überall)", () => {
    const items = [item({ id: 7, level: "error" }), item({ id: 5, kind: "session.turn_end", level: "success" })];
    expect(unseenBySection(items, { "": 7 }, new Set())).toEqual({ errors: 0, questions: 0, rest: 0 });
  });

  it("gemischt: nur der Abschnitt mit neuen Meldungen zählt (Vorgabe: nur der offen)", () => {
    const items = [
      item({ id: 3, level: "error" }),
      item({ id: 8, kind: "session.turn_end", level: "success" }),
      item({ id: 9, kind: "session.turn_end", level: "success" }),
    ];
    expect(unseenBySection(items, { "": 3 }, new Set())).toEqual({ errors: 0, questions: 0, rest: 2 });
  });

  it("Fleet: Read-Marks gelten pro Host — Peer-Neuigkeit zählt trotz gelesenem eigenem Hub", () => {
    const items = [item({ id: 2, hostId: "peer", level: "error" })];
    expect(unseenBySection(items, { "": 9 }, new Set())).toEqual({ errors: 1, questions: 0, rest: 0 });
  });

  it("SECTION_KEYS deckt genau die drei Abschnitte ab", () => {
    expect(SECTION_KEYS).toEqual(["errors", "questions", "rest"]);
  });
});

describe("defaultExpanded — Vorgabe: nur Ungesehenes (und offene Fragen) offen", () => {
  it("alles ungesehen → alle Abschnitte offen", () => {
    const items = [
      item({ id: 7, level: "error" }),
      item({ id: 6, kind: "tool.permission_requested", sessionId: "s1" }),
      item({ id: 5, kind: "session.turn_end", level: "success" }),
    ];
    expect(defaultExpanded(items, {}, new Set(["#s1"]))).toEqual({ errors: true, questions: true, rest: true });
  });

  it("alles gesehen und keine offene Frage → alles zu", () => {
    const items = [item({ id: 7, level: "error" }), item({ id: 5, kind: "session.turn_end", level: "success" })];
    expect(defaultExpanded(items, { "": 7 }, new Set())).toEqual({ errors: false, questions: false, rest: false });
  });

  it("nur ein Abschnitt hat Neues → nur der steht offen", () => {
    const items = [
      item({ id: 3, level: "error" }),
      item({ id: 8, kind: "session.turn_end", level: "success" }),
    ];
    expect(defaultExpanded(items, { "": 3 }, new Set())).toEqual({ errors: false, questions: false, rest: true });
  });

  it("live offene Freigabe bleibt Vorgabe-offen, obwohl gelesen — Read-Mark löscht keine offene Frage (wie der Glow)", () => {
    const items = [item({ id: 2, kind: "session.steer_pending_approval", sessionId: "s1" })];
    expect(defaultExpanded(items, { "": 9 }, new Set(["#s1"]))).toEqual({ errors: false, questions: true, rest: false });
  });

  it("beantwortete (nicht mehr offene) Frage klappt nach dem Lesen zu", () => {
    const items = [item({ id: 2, kind: "session.steer_pending_approval", sessionId: "s1" })];
    expect(defaultExpanded(items, { "": 2 }, new Set())).toEqual({ errors: false, questions: false, rest: false });
  });
});
