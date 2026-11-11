import { describe, expect, it } from "vitest";
import { parseTestCase, toDevicePoint } from "../../../src/features/devices/device-model.ts";

/** EPIC-P42 (ADR-0067): reine Hilfen des Geräte-Panels. */
describe("device-model (ADR-0067)", () => {
  it("rechnet Klicks auf das skalierte Standbild in Geräte-Koordinaten um", () => {
    const box = { left: 100, top: 50, width: 320, height: 600 };
    expect(toDevicePoint({ x: 260, y: 350 }, box, { width: 1080, height: 2400 })).toEqual({ x: 540, y: 1200 });
    expect(toDevicePoint({ x: 99, y: 350 }, box, { width: 1080, height: 2400 })).toBeNull(); // daneben
    expect(toDevicePoint({ x: 260, y: 350 }, { ...box, width: 0 }, { width: 1080, height: 2400 })).toBeNull();
  });

  it("Rotation ändert die natürliche Bildgröße — dasselbe Mapping trifft den gedrehten Punkt", () => {
    // Quer-Bild 2400×1080 im selben Kasten: Anteil bleibt, Ziel ist die gedrehte Fläche.
    expect(toDevicePoint({ x: 260, y: 350 }, { left: 100, top: 50, width: 320, height: 600 }, { width: 2400, height: 1080 })).toEqual({ x: 1200, y: 540 });
  });

  it("Testfall-Editor: gültig, Syntaxfehler und Schemafehler mit lesbarer Meldung", () => {
    expect(parseTestCase('{"name":"t","serial":"emulator-5554","steps":[{"type":"wait","ms":500}]}').ok).toBe(true);
    const bad = parseTestCase("{");
    expect(!bad.ok && bad.error).toMatch(/Kein gültiges JSON/);
    const schema = parseTestCase('{"name":"t","serial":"emulator-5554","steps":[{"type":"shell","cmd":"rm"}]}');
    expect(!schema.ok && schema.error).toMatch(/Ungültiger Testfall/);
  });
});
