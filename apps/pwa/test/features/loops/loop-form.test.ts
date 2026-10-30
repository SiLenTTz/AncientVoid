import { describe, expect, it } from "vitest";
import type { LoopInfo, LoopCapabilities, LoopOnboarding } from "@uacc/contracts";
import { loopBlocker, onboardSelectDefaults } from "../../../src/features/loops/loop-form.ts";

const caps = (over: Partial<LoopCapabilities>): LoopCapabilities => ({ agents: "external", intake: ["backlog"], modes: [], riskyModes: [], orchestrators: [], controls: [], gates: [], asks: "none", options: [], ...over });
const info = (c: LoopCapabilities): LoopInfo => ({ id: "x", label: "X", description: "", transport: "cli", available: true, capabilities: c });

describe("loopBlocker: Onboarding mit und ohne Geheimnis (T26.4, EPIC-P26)", () => {
  it("ohne secret-Feld wird kein Geheimnis verlangt, sobald die Pflichtfelder stehen", () => {
    const onboarding = { optionKey: "anbindung", label: "Factory-Projekt einrichten", fields: [{ key: "root", label: "Projektpfad", kind: "text" as const, required: true }] };
    const i = info(caps({ options: [{ key: "anbindung", label: "Anbindung", kind: "select" as const, choices: [{ value: "+neu", label: "neu" }] }], onboarding }));
    expect(loopBlocker(i, { id: "x", options: { anbindung: "+neu" } }, true, { values: { root: "/tmp/p" }, secret: "" })).toBeNull();
    expect(loopBlocker(i, { id: "x", options: { anbindung: "+neu" } }, true, { values: {}, secret: "" })).toBe("Projektpfad fehlt");
  });

  it("mit secret-Feld bleibt die Altregel: fehlendes Geheimnis blockiert (aSPARK)", () => {
    const onboarding = { optionKey: "line", label: "Linie", fields: [], secret: { label: "Repo-Token" } };
    const i = info(caps({ options: [{ key: "line", label: "Linie", kind: "select" as const, choices: [{ value: "+neu", label: "neu" }] }], onboarding }));
    expect(loopBlocker(i, { id: "x", options: { line: "+neu" } }, true, { values: {}, secret: "" })).toBe("Repo-Token fehlt");
  });
});

describe("onboardSelectDefaults: angezeigte Select-Vorgaben gelten als gewählt (Nutzerfund 2026-10-30)", () => {
  const onboarding: LoopOnboarding = {
    optionKey: "line",
    label: "Neues Repo anbinden",
    fields: [
      { key: "art", label: "Art", kind: "select", required: true, choices: [{ value: "projekt", label: "Projekt" }, { value: "umgebung", label: "Umgebung" }] },
      { key: "root", label: "Projektpfad", kind: "text", required: true },
    ],
  };

  it("leere Pflicht-Selects bekommen ihre erste Wahl in den Zustand", () => {
    expect(onboardSelectDefaults(onboarding, {})).toEqual({ art: "projekt" });
  });

  it("eine eigene Wahl wird nie überschrieben, Textfelder werden nicht vorbefüllt", () => {
    const values = { art: "umgebung", root: "" };
    expect(onboardSelectDefaults(onboarding, values)).toBe(values);
  });

  it("zusammen mit loopBlocker blockiert danach nur, was wirklich fehlt", () => {
    const i = info(caps({ options: [{ key: "line", label: "Linie", kind: "select", choices: [{ value: "+neu", label: "neu" }] }], onboarding }));
    const spec = { id: "x", options: { line: "+neu" } };
    const draft = { values: onboardSelectDefaults(onboarding, {}), secret: "" };
    expect(loopBlocker(i, spec, true, draft)).toBe("Projektpfad fehlt");
  });
});
