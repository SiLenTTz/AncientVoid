import { describe, expect, it } from "vitest";
import { contextWindowFor, modelsFromCommand, parseModelLines, parseModelTable, resolveContextWindow } from "../src/index.ts";

describe("contextWindowFor (ADR-0032, Quelle models.dev 2026-09-26)", () => {
  it("kennt die GLM-Familie inklusive provider-Präfix und Suffixe", () => {
    expect(contextWindowFor("zai-coding-plan/glm-5.3")).toBe(1_000_000);
    expect(contextWindowFor("zai-coding-plan/glm-5.3-highspeed")).toBe(1_000_000);
    expect(contextWindowFor("glm-5.2")).toBe(1_000_000);
    expect(contextWindowFor("zai-coding-plan/glm-5.3-flash")).toBe(1_000_000);
    expect(contextWindowFor("zai-coding-plan/glm-4.7")).toBe(204_800);
    expect(contextWindowFor("zai-coding-plan/glm-5-turbo")).toBe(200_000);
    expect(contextWindowFor("glm-5.3-flashx")).toBe(1_000_000);
  });

  it("kennt die OpenCode-Zen-Modelle des Nutzers", () => {
    expect(contextWindowFor("opencode/big-pickle")).toBe(200_000);
    expect(contextWindowFor("opencode/space-bunny-free")).toBe(1_048_576);
    expect(contextWindowFor("opencode/nemotron-3-ultra-free")).toBe(1_000_000);
    expect(contextWindowFor("opencode/nemotron-3.5-lightning-free")).toBe(262_144);
    expect(contextWindowFor("opencode/mimo-v2.6-flash-free")).toBe(200_000);
    expect(contextWindowFor("opencode/ling-3.0-flash-fin-free")).toBe(262_144);
    expect(contextWindowFor("opencode/muse-spark-1.3-contributor-free")).toBe(1_048_576);
  });

  it("evox2: das lokale Halogen-Quant hat 131072, die Cloud-Variante qwen3.8 behält ihr Fenster", () => {
    expect(contextWindowFor("evo-evox2/halogen-qwen3.8-flash-next-uncensored-iq4xs")).toBe(131_072);
    expect(contextWindowFor("qwen3.8-plus")).toBe(1_000_000);
  });

  it("kennt die großen Familien", () => {
    expect(contextWindowFor("claude-haiku-4-5")).toBe(200_000);
    expect(contextWindowFor("claude-sonnet-5")).toBe(1_000_000);
    expect(contextWindowFor("gpt-6-astra")).toBe(1_050_000);
    expect(contextWindowFor("gpt-5.3-codex")).toBe(400_000);
    expect(contextWindowFor("gpt-5.3-codex-spark")).toBe(128_000);
    expect(contextWindowFor("grok-4.7")).toBe(500_000);
    expect(contextWindowFor("gemini-3.8-flash")).toBe(1_048_576);
    expect(contextWindowFor("kimi-k3")).toBe(1_048_576);
  });
});

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

  it("matcht auch den Rohwert (JSON-Paar wie bei manchen Agenten)", () => {
    expect(resolveContextWindow("lokal/glm-5.3", '["lokal","glm-5.3"]', { lokal: 555 })).toBe(555);
    expect(resolveContextWindow("lokal/klein", '["lokal","klein"]', {})).toBeNull();
  });
});

describe("parseModelTable (pi --list-models, live 2026-11-09)", () => {
  it("macht aus Tabellenzeilen provider/model und nimmt den Kontext ins Label", () => {
    const out = "provider   model                  context  max-out  thinking  images\nevo-evox2  halogen-qwen3.8-iq4xs  131.1K   32.8K    yes       no\nanthropic  claude-opus-5-5        1M       64K      yes       yes\n";
    expect(parseModelTable(out)).toEqual([
      { id: "evo-evox2/halogen-qwen3.8-iq4xs", label: "evo-evox2/halogen-qwen3.8-iq4xs · 131.1K Kontext" },
      { id: "anthropic/claude-opus-5-5", label: "anthropic/claude-opus-5-5 · 1M Kontext" },
    ]);
  });

  it("erkennt ein unbekanntes Format nicht an — keine geratenen Modelle", () => {
    expect(parseModelTable("No models available.\n")).toEqual([]);
    expect(parseModelTable("")).toEqual([]);
    expect(parseModelTable("model provider\nx y 1K\n")).toEqual([]);
  });
});
