import { describe, expect, it } from "vitest";
import { closeTile, detachTile, isDetached, reattach, cycleLayout, emptyWorkspace, focusTile, openInNewTile, openSession, parseWorkspace, serializeWorkspace, setLayout, swapWith, tileCount, visibleTiles } from "../../../src/features/workspace/tiles.ts";

const a = { sessionId: "a" };
const b = { sessionId: "b" };
const c = { sessionId: "c", hostId: "h2" };

describe("Kachel-Zustand (T18.2)", () => {
  it("startet mit einer leeren Kachel", () => {
    const ws = emptyWorkspace();
    expect(ws.layout).toBe("1");
    expect(visibleTiles(ws)).toEqual([null]);
  });

  it("Öffnen füllt die Fokus-Kachel, eine schon sichtbare Session bekommt nur den Fokus", () => {
    let ws = setLayout(emptyWorkspace(), "2v");
    ws = openSession(ws, a);
    expect(visibleTiles(ws)).toEqual([a, null]);
    ws = focusTile(ws, 1);
    ws = openSession(ws, b);
    expect(visibleTiles(ws)).toEqual([a, b]);
    ws = openSession(ws, a);
    expect(ws.focus).toBe(0);
    expect(visibleTiles(ws)).toEqual([a, b]);
  });

  it("eine belegte Fokus-Kachel lässt freie Kacheln zuerst füllen", () => {
    let ws = openSession(setLayout(emptyWorkspace(), "2v"), a);
    ws = openSession(ws, b);
    expect(visibleTiles(ws)).toEqual([a, b]);
    expect(ws.focus).toBe(1);
  });

  it("in einer neuen Kachel öffnen wächst 1 → 2v → 1+2 → 2x2, danach ersetzt es die Fokus-Kachel", () => {
    let ws = openSession(emptyWorkspace(), a);
    ws = openInNewTile(ws, b);
    expect(ws.layout).toBe("2v");
    ws = openInNewTile(ws, c);
    expect(ws.layout).toBe("1+2");
    ws = openInNewTile(ws, { sessionId: "d" });
    expect(ws.layout).toBe("2x2");
    expect(visibleTiles(ws).map((t) => t?.sessionId)).toEqual(["a", "b", "c", "d"]);
    ws = openInNewTile(ws, { sessionId: "e" });
    expect(ws.layout).toBe("2x2");
    expect(visibleTiles(ws)[ws.focus]?.sessionId).toBe("e");
  });

  it("kleineres Layout verliert nichts: zurück auf 2x2 sind alle wieder da", () => {
    let ws = setLayout(emptyWorkspace(), "2x2");
    for (const [i, s] of ["a", "b", "c", "d"].entries()) ws = openSession(focusTile(ws, i), { sessionId: s });
    ws = setLayout(ws, "2v");
    expect(visibleTiles(ws).map((t) => t?.sessionId)).toEqual(["a", "b"]);
    expect(ws.focus).toBe(1);
    ws = setLayout(ws, "2x2");
    expect(visibleTiles(ws).map((t) => t?.sessionId)).toEqual(["a", "b", "c", "d"]);
  });

  it("Layout-Zyklus vor und zurück", () => {
    expect(cycleLayout(emptyWorkspace(), 1).layout).toBe("2v");
    expect(cycleLayout(emptyWorkspace(), -1).layout).toBe("2x2");
    expect(tileCount("1+2")).toBe(3);
  });

  it("Fokus nur auf sichtbare Kacheln", () => {
    expect(focusTile(emptyWorkspace(), 3).focus).toBe(0);
  });

  it("Tauschen bewegt die Fokus-Session, der Fokus wandert mit", () => {
    let ws = setLayout(emptyWorkspace(), "2v");
    ws = openSession(ws, a);
    ws = openSession(ws, b);
    ws = focusTile(ws, 0);
    ws = swapWith(ws, 1);
    expect(visibleTiles(ws)).toEqual([b, a]);
    expect(ws.focus).toBe(1);
  });

  it("Schließen leert die Kachel", () => {
    const ws = closeTile(openSession(emptyWorkspace(), a), 0);
    expect(visibleTiles(ws)).toEqual([null]);
  });

  it("Speichern und Laden, kaputte Daten ergeben einen leeren Arbeitsplatz", () => {
    let ws = openInNewTile(openSession(emptyWorkspace(), a), c);
    expect(parseWorkspace(serializeWorkspace(ws))).toEqual(ws);
    expect(parseWorkspace("{kaputt")).toEqual(emptyWorkspace());
    expect(parseWorkspace(JSON.stringify({ layout: "9x9", slots: [], focus: 7 }))).toEqual(emptyWorkspace());
    ws = parseWorkspace(JSON.stringify({ layout: "2v", slots: [{ sessionId: "a" }, { sessionId: 5 }, null, null], focus: 1 }));
    expect(visibleTiles(ws)).toEqual([a, null]);
  });
});

describe("Abgelöste Kacheln (EPIC-P34 T34.10)", () => {
  it("ablösen leert die Kachel und merkt die Session; zurückholen öffnet sie wieder", () => {
    let ws = openSession(setLayout(emptyWorkspace(), "2v"), a);
    ws = openSession(ws, b);
    ws = detachTile(ws, 0);
    expect(visibleTiles(ws)).toEqual([null, b]);
    expect(isDetached(ws, a)).toBe(true);
    ws = reattach(ws, a);
    expect(isDetached(ws, a)).toBe(false);
    expect(visibleTiles(ws).some((t) => t?.sessionId === "a")).toBe(true);
  });

  it("eine leere Kachel löst nichts ab; doppeltes Ablösen führt die Session nur einmal", () => {
    const ws = setLayout(emptyWorkspace(), "2v");
    expect(detachTile(ws, 1)).toBe(ws);
    const once = detachTile(openSession(ws, a), 0);
    expect(once.detached).toEqual([a]);
    expect(reattach(reattach(once, a), a).detached ?? []).toEqual([]);
  });

  it("detached übersteht Speichern und Laden; alte Stände ohne das Feld bleiben gültig", () => {
    const ws = detachTile(openSession(emptyWorkspace(), c), 0);
    expect(parseWorkspace(serializeWorkspace(ws)).detached).toEqual([c]);
    expect(parseWorkspace(JSON.stringify({ layout: "1", slots: [a, null, null, null], focus: 0 })).detached).toBeUndefined();
    expect(parseWorkspace(JSON.stringify({ layout: "1", slots: [null, null, null, null], focus: 0, detached: [{ sessionId: 5 }, "x", a] })).detached).toEqual([a]);
  });
});
