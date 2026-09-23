import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recommendForPrompt, writeProjectArtifact, type SkillOrAgent } from "../src/skills.ts";

const bugfix: SkillOrAgent = { kind: "skill", name: "bugfix", description: "Defekt reproduzieren und fixen" };
const review: SkillOrAgent = { kind: "skill", name: "pr-review", description: "Merge-Request pruefen" };

describe("recommendForPrompt", () => {
  it("picks the skill whose description shares the prompt's words", () => {
    const rec = recommendForPrompt("Bitte den Defekt im Login reproduzieren und fixen", [review, bugfix]);
    expect(rec).toMatchObject({ mode: "match", kind: "skill", name: "bugfix", draft: null });
  });

  it("matches a workflow file when its name is in the prompt", () => {
    const rec = recommendForPrompt("Starte den Release-Workflow", [
      { kind: "workflow", name: "release", description: "Release schneiden" },
    ]);
    expect(rec).toMatchObject({ mode: "match", kind: "workflow", name: "release" });
  });

  const base = (name: string, description: string): SkillOrAgent => ({ kind: "skill", name, description, layer: "base" });
  const bases = [
    base("task", "Gemeinsame Form jeder Aufgabe: Ziel, Scope, Constraints, Erfolgskriterium."),
    base("investigate", "Ursache lesen und belegen, ohne Dateien zu ändern."),
    base("change", "Eine abgegrenzte Änderung mit Test, der das Erfolgskriterium prüft."),
    base("review", "Vorhandene Änderung prüfen, ohne selbst zu schreiben."),
  ];
  const enhanced = (goal: string) =>
    `Ziel: ${goal}\nScope: nur das genannte Projekt\nConstraints: keine neuen Abhängigkeiten\nErfolgskriterium: Tests grün`;

  it("never turns a one-off prompt into a skill draft", () => {
    expect(recommendForPrompt("Baue ein Neon-Tetris mit Punkteanzeige", [])).toBeNull();
    expect(recommendForPrompt("Baue ein Neon-Tetris mit Punkteanzeige und Glow", bases)).toBeNull();
  });

  it("ignores the headings every enhanced prompt carries", () => {
    expect(recommendForPrompt(enhanced("Mach die Login-Seite schneller"), bases)).toBeNull();
    expect(recommendForPrompt(enhanced("Farben der Startseite anpassen"), [bugfix, review, ...bases])).toBeNull();
  });

  it("needs more than one shared word", () => {
    expect(recommendForPrompt("Bitte ein review der Datei", [review])).toBeNull();
  });

  it("recommends a base skill as it is when it clearly fits", () => {
    const rec = recommendForPrompt(enhanced("Ursache für den Absturz lesen und belegen"), bases);
    expect(rec).toMatchObject({ mode: "match", name: "investigate", draft: null });
  });

  it("keeps a matching project skill ahead of a base skill", () => {
    const rec = recommendForPrompt("Bitte den Defekt im Login reproduzieren und fixen", [
      { kind: "skill", name: "task", description: "Defekt und Form", layer: "base" },
      bugfix,
    ]);
    expect(rec).toMatchObject({ mode: "match", name: "bugfix" });
  });

  it("proposes a new skill, agent or workflow only when the prompt asks for one", () => {
    expect(recommendForPrompt("Baue einen Agent der Reviews macht", [])).toMatchObject({ mode: "create", kind: "agent" });
    expect(recommendForPrompt("Beschreibe den Release-Ablauf als Workflow", [])).toMatchObject({ mode: "create", kind: "workflow" });
    const skill = recommendForPrompt(enhanced("Lege einen Skill für Changelog-Einträge an"), bases);
    expect(skill).toMatchObject({ mode: "create", kind: "skill", name: "changelog-eintraege" });
    expect(skill?.draft).toContain("extends: task");
  });
});

describe("writeProjectArtifact", () => {
  it("writes a skill once and refuses to overwrite it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uacc-artifact-"));
    try {
      const written = await writeProjectArtifact(dir, {
        kind: "skill",
        name: "neon-tetris",
        draft: "---\nname: neon-tetris\n---\n\n# neon\n",
      });
      expect(written.path).toBe(join(".claude", "skills", "neon-tetris", "SKILL.md"));
      const text = await readFile(join(dir, written.path), "utf8");
      expect(text).toContain("name: neon-tetris");
      await expect(
        writeProjectArtifact(dir, { kind: "skill", name: "neon-tetris", draft: "---\nname: neon-tetris\n---\n" }),
      ).rejects.toThrow(/already exists/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a name that is not a slug", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uacc-artifact-"));
    try {
      await expect(writeProjectArtifact(dir, { kind: "agent", name: "../etc", draft: "x" })).rejects.toThrow(/invalid artifact name/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
