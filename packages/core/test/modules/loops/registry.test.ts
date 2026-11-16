import { describe, expect, it } from "vitest";
import { createFakeLoopConnector } from "@ancientvoid/adapter-testkit";
import { LoopRegistry, NOT_CONFIGURED_REASON } from "../../../src/modules/loops/registry.ts";

describe("LoopRegistry", () => {
  it("der Katalog zeigt beide Loops, ohne Connector gesperrt und mit Grund", () => {
    const loops = new LoopRegistry();
    const list = loops.list();
    expect(list.map((l) => l.id)).toEqual(["aspark-factory", "securesight-factory"]);
    expect(list.every((l) => !l.available && l.reason === NOT_CONFIGURED_REASON && l.capabilities === null)).toBe(true);
    expect(() => loops.assertStartable({ id: "aspark-factory" })).toThrow(/nicht startbar/);
  });

  it("ein registrierter Connector macht seinen Loop startbar und liefert die Fähigkeiten", () => {
    const loops = new LoopRegistry();
    loops.register(createFakeLoopConnector());
    const fake = loops.list().find((l) => l.id === "fake-loop");
    expect(fake).toMatchObject({ available: true, capabilities: { modes: ["ruhig", "scharf"], riskyModes: ["scharf"] } });
    expect(loops.assertStartable({ id: "fake-loop", options: { line: "alpha" } }).available).toBe(true);
  });

  it("ein Loop, der nicht lädt, bleibt sichtbar — mit dem Grund", () => {
    const loops = new LoopRegistry();
    loops.markFailed("aspark-factory", "Connector konnte nicht geladen werden: kaputt");
    expect(loops.list()[0]).toMatchObject({ id: "aspark-factory", available: false, reason: "Connector konnte nicht geladen werden: kaputt" });
  });

  it("Betriebsart, Orchestrator, Optionen und Pflichtfelder werden gegen die Fähigkeiten geprüft", () => {
    const loops = new LoopRegistry();
    loops.register(createFakeLoopConnector());
    const ok = { id: "fake-loop", options: { line: "alpha" } };
    expect(() => loops.assertStartable({ ...ok, mode: "scharf" })).not.toThrow();
    expect(() => loops.assertStartable({ ...ok, mode: "dark" })).toThrow(/Betriebsart „dark“/);
    expect(() => loops.assertStartable({ ...ok, orchestrator: "hermes" })).toThrow(/Orchestrator/);
    expect(() => loops.assertStartable({ id: "fake-loop" })).toThrow(/Option „Line“ fehlt/);
    expect(() => loops.assertStartable({ id: "fake-loop", options: { line: "a", zufall: "x" } })).toThrow(/kennt die Option „zufall“/);
  });
});

describe("assertStartable: reservierte Hub-Option „driver“ (ADR-0043, EPIC-P26 T26.5)", () => {
  it("die Treiber-Verknüpfung ist keine Connector-Option und wird nicht abgelehnt", () => {
    const loops = new LoopRegistry();
    loops.register(createFakeLoopConnector());
    expect(() => loops.assertStartable({ id: "fake-loop", options: { line: "alpha", driver: "eb0f764a-0000" } })).not.toThrow();
    // unverändert: jede andere unbekannte Option bleibt laut abgelehnt
    expect(() => loops.assertStartable({ id: "fake-loop", options: { line: "alpha", zufall: "x" } })).toThrow(/kennt die Option „zufall“/);
  });
});
