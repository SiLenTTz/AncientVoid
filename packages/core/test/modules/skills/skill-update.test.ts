import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readProjectArtifact, recommendForPrompt, updateProjectArtifact, type SkillOrAgent } from "../../../src/modules/skills/index.ts";

const changelog: SkillOrAgent = { kind: "skill", name: "changelog", description: "Changelog-Einträge nach Konvention schreiben" };
const bugfix: SkillOrAgent = { kind: "skill", name: "bugfix", description: "Defekt reproduzieren, fixen, verifizieren" };
const investigate: SkillOrAgent = { kind: "skill", name: "investigate", description: "Ursache lesen und belegen, ohne Fix", layer: "base" };

describe("recommendForPrompt — adapt instead of duplicate (EPIC-P68, AC-P68-4)", () => {
  it("a request for a skill that exists in spirit offers the existing one to adapt", () => {
    const rec = recommendForPrompt("Lege einen Skill für Changelog-Einträge im Release an", [bugfix, changelog]);
    expect(rec).toMatchObject({ mode: "update", kind: "skill", name: "changelog", draft: null });
    expect(rec?.reason).toContain("Anpassen statt neu anlegen");
  });

  it("two shared words are enough to call it a near-duplicate", () => {
    const rec = recommendForPrompt("Erstelle einen Skill: Defekt reproduzieren im Checkout", [changelog, bugfix]);
    expect(rec).toMatchObject({ mode: "update", name: "bugfix" });
  });

  it("base skills are never offered for update; a base match is marked as base", () => {
    expect(recommendForPrompt("Erstelle einen Skill für Ursache lesen und belegen", [investigate])?.mode).not.toBe("update");
    expect(recommendForPrompt("Ursache für den Absturz lesen und belegen", [investigate])).toMatchObject({ mode: "match", layer: "base" });
  });

  it("without an existing neighbour a request still creates", () => {
    expect(recommendForPrompt("Lege einen Skill für Neon-Tetris-Levels an", [bugfix])).toMatchObject({ mode: "create" });
  });
});

describe("readProjectArtifact / updateProjectArtifact (AC-P68-5)", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function project(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-skill-update-"));
    dirs.push(dir);
    // Directory name differs from the frontmatter name — the listed name wins.
    await mkdir(join(dir, ".claude", "skills", "release-notes"), { recursive: true });
    await writeFile(join(dir, ".claude", "skills", "release-notes", "SKILL.md"), "---\nname: changelog\ndescription: alt\n---\nAlt.\n");
    return dir;
  }

  it("reads by listed name and writes only against the hash it read", async () => {
    const dir = await project();
    const read = await readProjectArtifact(dir, "skill", "changelog");
    expect(read).toMatchObject({ path: join(".claude", "skills", "release-notes", "SKILL.md"), content: expect.stringContaining("Alt.") });
    const draft = "---\nname: changelog\ndescription: neu\n---\nNeu.";
    const written = await updateProjectArtifact(dir, { kind: "skill", name: "changelog", draft }, read!.hash);
    expect(await readFile(join(dir, ".claude", "skills", "release-notes", "SKILL.md"), "utf8")).toBe(`${draft}\n`);
    expect(written.hash).not.toBe(read!.hash);

    // The old hash is stale now — no last-write-wins.
    await expect(updateProjectArtifact(dir, { kind: "skill", name: "changelog", draft: "---\nname: changelog\n---\nX" }, read!.hash)).rejects.toThrow("artifact changed");
  });

  it("only one concurrent update can consume the same base hash", async () => {
    const dir = await project();
    const artifact = (await readProjectArtifact(dir, "skill", "changelog"))!;
    const results = await Promise.allSettled(["One", "Two"].map((body) =>
      updateProjectArtifact(dir, { kind: "skill", name: "changelog", draft: artifact.content + body }, artifact.hash),
    ));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason.message).toBe("artifact changed");
  });

  it("does not read or overwrite a skill symlink outside the project", async () => {
    const dir = await project();
    const outside = await project();
    const target = join(outside, ".claude", "skills", "release-notes", "SKILL.md");
    await mkdir(join(dir, ".claude", "skills", "external"));
    await symlink(target, join(dir, ".claude", "skills", "external", "SKILL.md"));
    await expect(readProjectArtifact(dir, "skill", "external")).rejects.toThrow("artifact path escapes the project");
    const before = await readFile(target, "utf8");
    await expect(updateProjectArtifact(dir, { kind: "skill", name: "external", draft: before }, "0".repeat(64))).rejects.toThrow("artifact path escapes the project");
    expect(await readFile(target, "utf8")).toBe(before);
  });

  it("refuses a renamed frontmatter, a missing entry and a bad name", async () => {
    const dir = await project();
    const read = await readProjectArtifact(dir, "skill", "changelog");
    await expect(updateProjectArtifact(dir, { kind: "skill", name: "changelog", draft: "---\nname: anders\n---\nX" }, read!.hash)).rejects.toThrow("artifact name mismatch");
    await expect(updateProjectArtifact(dir, { kind: "agent", name: "changelog", draft: "x" }, read!.hash)).rejects.toThrow("artifact not found");
    await expect(readProjectArtifact(dir, "skill", "../etc")).rejects.toThrow("invalid artifact name");
    expect(await readProjectArtifact(dir, "workflow", "nix")).toBeNull();
  });
});
