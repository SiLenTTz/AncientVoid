import { beforeEach, describe, expect, it } from "vitest";

const mem = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
});

const first = await import("../../src/shared/first-run.ts");
const { showStartGuide, emptyText } = await import("../../src/features/overview/start-guide.ts");

beforeEach(() => mem.clear());

describe("Erststart: Erfolgssignal (AC-P57-7)", () => {
  it("ohne Einstieg (bestehendes Gerät) gibt es nie ein Signal", () => {
    expect(first.noteApprovalDecided()).toBe(false);
    expect(first.firstSignalPending()).toBe(false);
  });

  it("nach dem Einstieg macht die erste entschiedene Freigabe das Signal fällig, Schließen beendet es für immer", () => {
    first.armFirstRun();
    expect(first.firstSignalPending()).toBe(false);
    expect(first.noteApprovalDecided()).toBe(true);
    expect(first.firstSignalPending()).toBe(true);
    first.dismissFirstSignal();
    expect(first.firstSignalPending()).toBe(false);
    first.armFirstRun();
    expect(first.noteApprovalDecided()).toBe(false);
  });

  it("ein beschädigter Eintrag gilt als neues Gerät", () => {
    mem.set("ancientvoid.firstRun", "kaputt");
    expect(first.firstSignalPending()).toBe(false);
    first.armFirstRun();
    expect(mem.get("ancientvoid.firstRun")).toBe("armed");
  });
});

describe("Erststart: Einstieg nur im echten Leerzustand (AC-P57-7)", () => {
  const empty = { total: 0, visible: 0, query: "", hostFiltered: false, showArchived: false, statusFilter: "all" };
  it("leerer Hub ohne Filter zeigt den Einstieg", () => {
    expect(showStartGuide(empty)).toBe(true);
    expect(showStartGuide({ ...empty, statusFilter: "recent" })).toBe(true);
  });
  it("Suche, Hostfilter, Statusfilter, Archiv und vorhandene (auch archivierte) Sessions zeigen ihn nicht", () => {
    expect(showStartGuide({ ...empty, query: "x" })).toBe(false);
    expect(showStartGuide({ ...empty, hostFiltered: true })).toBe(false);
    expect(showStartGuide({ ...empty, statusFilter: "waiting" })).toBe(false);
    expect(showStartGuide({ ...empty, showArchived: true })).toBe(false);
    expect(showStartGuide({ ...empty, total: 2 })).toBe(false);
  });
  it("die alten Leerzustände bleiben wörtlich", () => {
    expect(emptyText({ query: "x", hostFiltered: false, showArchived: false })).toBe("nichts gefunden");
    expect(emptyText({ query: "", hostFiltered: false, showArchived: true })).toBe("nichts archiviert");
    expect(emptyText({ query: "", hostFiltered: false, showArchived: false })).toBe("keine Sessions — lege eine an");
  });
});
