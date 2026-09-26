import { describe, expect, it } from "vitest";
import { contextWindowFor, resolveContextWindow } from "../src/index.ts";

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

  it("unbekannt bleibt unbekannt — nie geraten", () => {
    expect(contextWindowFor("jev-1.13")).toBeNull();
    expect(contextWindowFor("custom/Mein-Modell")).toBeNull();
    expect(contextWindowFor("")).toBeNull();
  });
});

describe("resolveContextWindow — Konfiguration schlägt Tabelle", () => {
  it("Override gewinnt gegen die Kuratierte Liste", () => {
    expect(resolveContextWindow("zai-coding-plan/glm-5.3", undefined, { glm: 123_456 })).toBe(123_456);
  });

  it("matcht auch den Rohwert (JSON-Paar wie bei manchen Agenten)", () => {
    expect(resolveContextWindow("lokal/glm-5.3", '["lokal","glm-5.3"]', { lokal: 555 })).toBe(555);
    expect(resolveContextWindow("lokal/klein", '["lokal","klein"]', {})).toBeNull();
  });

  it("ohne Override gilt die Tabelle", () => {
    expect(resolveContextWindow("glm-5.3", undefined, {})).toBe(1_000_000);
  });
});
