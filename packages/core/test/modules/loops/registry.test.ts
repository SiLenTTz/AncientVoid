import { describe, expect, it } from "vitest";
import { LoopRegistry } from "../../../src/modules/loops/registry.ts";

describe("LoopRegistry", () => {
  it("startbar wird ein Loop erst mit angebundenem Connector", () => {
    const loops = new LoopRegistry();
    expect(() => loops.assertStartable({ id: "securesight-factory" })).toThrow(/nicht startbar/);
    loops.markConnected("securesight-factory");
    expect(loops.assertStartable({ id: "securesight-factory" }).available).toBe(true);
    expect(loops.list().find((l) => l.id === "aspark-factory")?.available).toBe(false);
  });
  it("Optionen werden gegen die Fähigkeiten des Loops geprüft", () => {
    const loops = new LoopRegistry();
    loops.markConnected("securesight-factory");
    expect(() => loops.assertStartable({ id: "securesight-factory", options: { orchestrator: "hermes" } })).not.toThrow();
    expect(() => loops.assertStartable({ id: "securesight-factory", options: { orchestrator: "zufall" } })).toThrow(/keinen Wert/);
    expect(() => loops.assertStartable({ id: "securesight-factory", options: { modus: "dark" } })).toThrow(/kennt die Option/);
  });
});
