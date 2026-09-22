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
    expect(rec.mode).toBe("match");
    expect(rec.kind).toBe("skill");
    expect(rec.name).toBe("bugfix");
    expect(rec.draft).toBeNull();
  });

  it("matches a workflow file when its name is in the prompt", () => {
    const rec = recommendForPrompt("Starte den Release-Workflow", [
      { kind: "workflow", name: "release", description: "Release schneiden" },
    ]);
    expect(rec).toMatchObject({ mode: "match", kind: "workflow", name: "release" });
  });

  it("proposes a new skill when nothing in the project fits", () => {
    const rec = recommendForPrompt("Baue ein Neon-Tetris mit Punkteanzeige", []);
    expect(rec.mode).toBe("create");
    expect(rec.kind).toBe("skill");
    expect(rec.name).toBe("baue-neon-tetris-punkteanzeige");
    expect(rec.draft).toContain("name: baue-neon-tetris-punkteanzeige");
    expect(rec.draft).toContain("Neon-Tetris");
  });

  it("proposes an agent or a workflow when the prompt asks for one", () => {
    expect(recommendForPrompt("Baue einen Agent der Reviews macht", []).kind).toBe("agent");
    expect(recommendForPrompt("Beschreibe den Release-Ablauf als Workflow", []).kind).toBe("workflow");
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
