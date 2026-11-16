import { describe, expect, it } from "vitest";
import { parseTestCase, toViewportPoint } from "../../../src/features/browser/browser-model.ts";

describe("browser-model (ADR-0059)", () => {
  it("rechnet Klicks auf das skaliertes Standbild in Viewport-Koordinaten um", () => {
    const box = { left: 100, top: 50, width: 640, height: 400 };
    expect(toViewportPoint({ x: 420, y: 250 }, box, { width: 1280, height: 800 })).toEqual({ x: 640, y: 400 });
    expect(toViewportPoint({ x: 99, y: 250 }, box, { width: 1280, height: 800 })).toBeNull(); // außerhalb
    expect(toViewportPoint({ x: 420, y: 250 }, { ...box, width: 0 }, { width: 1280, height: 800 })).toBeNull();
  });

  it("Testfall-Editor: gültig, Syntaxfehler und Schemafehler mit lesbarer Meldung", () => {
    expect(parseTestCase('{"name":"t","steps":[{"type":"expectVisible","selector":"#a"}]}').ok).toBe(true);
    const bad = parseTestCase("{");
    expect(!bad.ok && bad.error).toMatch(/Kein gültiges JSON/);
    const schema = parseTestCase('{"name":"t","steps":[{"type":"script","code":"1"}]}');
    expect(!schema.ok && schema.error).toMatch(/Ungültiger Testfall/);
  });
});
