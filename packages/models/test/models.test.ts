import { describe, expect, it } from "vitest";
import { modelsFromCommand, parseModelLines, resolveContextWindow } from "../src/index.ts";

/** ADR-0054 (EPIC-P35 T35.7): config-getriebene Modell-Kataloge für Adapter. */
describe("parseModelLines (ADR-0054)", () => {
  it("liest provider/model und nackte ids, optional Label nach Tab", () => {
    expect(parseModelLines("zai/glm-5.3\nsonnet\tAnthropic Sonnet\nlokal/klein")).toEqual([
      { id: "zai/glm-5.3" },
      { id: "sonnet", label: "Anthropic Sonnet" },
      { id: "lokal/klein" },
    ]);
  });

  it("überspringt Warnungen, Kopfzeilen, Leerzeilen und Doppelte", () => {
    expect(parseModelLines("Warning: something\n# Kommentar\n\nzai/glm-5.3\nzai/glm-5.3\n12 models")).toEqual([{ id: "zai/glm-5.3" }]);
  });
});

describe("modelsFromCommand (ADR-0054)", () => {
  it("führt das Kommando read-only aus und parst die Zeilen (printf statt echter CLI)", async () => {
    const models = await modelsFromCommand(["printf", "lokal/gross\nlokal/klein"]);
    expect(models).toEqual([{ id: "lokal/gross" }, { id: "lokal/klein" }]);
  });

  it("ein Fehlschlag wird sichtbar, nie als leere Liste geschluckt", async () => {
    await expect(modelsFromCommand(["false"])).rejects.toThrow();
  });
});

describe("resolveContextWindow (ADR-0032/0054)", () => {
  it("Konfiguration schlägt die Tabelle, Tabelle schlägt unbekannt", () => {
    expect(resolveContextWindow("zai/glm-5.3", undefined, { "glm-5.3": 42 })).toBe(42);
    expect(resolveContextWindow("zai/glm-5.3", undefined, {})).toBe(1_000_000);
    expect(resolveContextWindow("völlig/unbekannt", undefined, {})).toBeNull();
  });
});
