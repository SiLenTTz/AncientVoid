import { beforeEach, describe, expect, it } from "vitest";
import { rememberedSkill, saveSelectedSkill } from "../../../src/features/composer/SkillOverlay.tsx";
import type { HarnessFeatures } from "../../../src/shared/api.ts";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});

const features = (over: Partial<Pick<HarnessFeatures, "skills" | "agents">>): HarnessFeatures =>
  ({
    followUp: true,
    interrupt: true,
    toolGate: "native",
    questions: true,
    modelChoice: "start",
    skills: over.skills ?? false,
    agents: over.agents ?? false,
    images: true,
    files: true,
    contextFork: true,
  }) as HarnessFeatures;

describe("gemerkte Skill-/Agent-Auswahl gegen Adapter-Features (BUG-0078)", () => {
  it("lädt einen gemerkten Agenten nur für Adapter mit agents-Unterstützung", () => {
    saveSelectedSkill("/work/app", { kind: "agent", name: "reviewer" });
    expect(rememberedSkill("/work/app", features({ agents: true }))).toEqual({ kind: "agent", name: "reviewer" });
    expect(rememberedSkill("/work/app", features({}))).toBeNull();
  });

  it("lädt einen gemerkten Skill nur für Adapter mit skills-Unterstützung", () => {
    saveSelectedSkill("/work/app", { kind: "skill", name: "bugfix" });
    expect(rememberedSkill("/work/app", features({ skills: true }))).toEqual({ kind: "skill", name: "bugfix" });
    expect(rememberedSkill("/work/app", features({}))).toBeNull();
  });

  it("ohne gemerkte Auswahl oder ohne Features ist nichts gesetzt", () => {
    saveSelectedSkill("/work/other", { kind: "agent", name: "r" });
    expect(rememberedSkill("/work/app", features({ agents: true, skills: true }))).toBeNull();
    expect(rememberedSkill("/work/other", undefined)).toBeNull();
  });
});
