import { describe, expect, it } from "vitest";
import { urgencyOf, type UrgencyItem } from "../../../src/features/notifications/urgency.ts";

/** EPIC-P64 T64.1: reine Dringlichkeits-Ableitung für den Glocken-Glow. */
function item(o: Partial<UrgencyItem> & { id: number }): UrgencyItem {
  return { hostId: null, sessionId: null, level: "info", kind: "session.info", ...o };
}

describe("urgencyOf — höchste offene Dringlichkeit (EPIC-P64)", () => {
  it("leerer Bestand: kein Glow", () => {
    expect(urgencyOf([], {}, new Set())).toBeNull();
  });

  it("ungelesener Fehler → error (rot)", () => {
    expect(urgencyOf([item({ id: 3, level: "error" })], {}, new Set())).toBe("error");
  });

  it("ungelesener Lauf-Ende → done (grün) — Toast-Unterdrückung (T8.6) ändert nichts am Glow", () => {
    expect(urgencyOf([item({ id: 4, kind: "session.turn_end", level: "success" })], {}, new Set())).toBe("done");
  });

  it("Freigabe-Frage mit live offener Freigabe → action (gelb), auch wenn der Eintrag gelesen ist", () => {
    const n = item({ id: 2, kind: "tool.permission_requested", sessionId: "s1" });
    expect(urgencyOf([n], { "": 9 }, new Set(["#s1"]))).toBe("action");
  });

  it("beantwortete Frage (nicht mehr pending) → kein action, ungelesener Rest zählt weiter", () => {
    const n = item({ id: 2, kind: "session.steer_pending_approval", sessionId: "s1" });
    expect(urgencyOf([n], {}, new Set())).toBeNull();
  });

  it("Priorität: error schlägt action schlägt done", () => {
    const items: UrgencyItem[] = [
      item({ id: 5, kind: "session.turn_end", level: "success" }),
      item({ id: 6, kind: "tool.permission_requested", sessionId: "s1" }),
      item({ id: 7, level: "error" }),
    ];
    expect(urgencyOf(items, {}, new Set(["#s1"]))).toBe("error");
    expect(urgencyOf(items.slice(0, 2), {}, new Set(["#s1"]))).toBe("action");
    expect(urgencyOf(items.slice(0, 1), {}, new Set(["#s1"]))).toBe("done");
  });

  it("gelesene Fehler und Läufe glühen nicht — Read-Mark je Host", () => {
    const items: UrgencyItem[] = [
      item({ id: 3, level: "error" }),
      item({ id: 8, kind: "session.turn_end", level: "success" }),
    ];
    expect(urgencyOf(items, { "": 8 }, new Set())).toBeNull();
  });

  it("Fleet: Read-Mark des eigenen Hubs zählt nicht für Peer-Einträge", () => {
    const items: UrgencyItem[] = [
      item({ id: 3, hostId: "peer", level: "error" }),
      item({ id: 1, hostId: null, level: "error" }),
    ];
    expect(urgencyOf(items, { "": 3 }, new Set())).toBe("error");
    expect(urgencyOf(items, { "": 3, peer: 3 }, new Set())).toBeNull();
  });

  it("action gilt pro Host: Peer-Frage mit Peer-Pending-Eintrag", () => {
    const n = item({ id: 9, hostId: "peer", kind: "tool.permission_requested", sessionId: "s2" });
    expect(urgencyOf([n], {}, new Set(["peer#s2"]))).toBe("action");
  });
});
