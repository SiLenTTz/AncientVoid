import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveSkillChain, withSkillChain } from "../src/skills.ts";

describe("resolveSkillChain", () => {
  let root: string;
  let project: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "uacc-chain-"));
    project = join(root, "proj");
    await mkdir(join(root, ".claude", "skills", "task"), { recursive: true });
    await writeFile(join(root, ".claude", "skills", "task", "SKILL.md"), "---\nname: task\ndescription: form\n---\nBASE\n");
    await mkdir(join(project, ".claude", "skills", "task"), { recursive: true });
    await writeFile(join(project, ".claude", "skills", "task", "SKILL.md"), "---\nname: task\ndescription: form\n---\nPROJECT\n");
    await mkdir(join(project, ".claude", "skills", "neon"), { recursive: true });
    await writeFile(
      join(project, ".claude", "skills", "neon", "SKILL.md"),
      "---\nname: neon\ndescription: look\nextends: task, missing\n---\nDELTA\n",
    );
    await mkdir(join(project, ".claude", "skills", "a"), { recursive: true });
    await writeFile(join(project, ".claude", "skills", "a", "SKILL.md"), "---\nname: a\ndescription: a\nextends: b\n---\nA\n");
    await mkdir(join(project, ".claude", "skills", "b"), { recursive: true });
    await writeFile(join(project, ".claude", "skills", "b", "SKILL.md"), "---\nname: b\ndescription: b\nextends: a\n---\nB\n");
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("loads ancestors first and prefers the project file over the catalog", async () => {
    const chain = await resolveSkillChain(project, "neon");
    expect(chain?.names).toEqual(["task", "neon"]);
    expect(chain?.block).toContain("PROJECT");
    expect(chain?.block).not.toContain("BASE");
    expect(chain?.block).toContain("fehlt: missing");
    expect(chain?.block.indexOf("PROJECT")).toBeLessThan(chain?.block.indexOf("DELTA") ?? -1);
  });

  it("returns null when the selected skill does not exist", async () => {
    expect(await resolveSkillChain(project, "nope")).toBeNull();
  });

  it("cuts a cycle after each skill is included once", async () => {
    const chain = await resolveSkillChain(project, "a");
    expect(chain?.names).toEqual(["b", "a"]);
  });

  it("does not prefix a prompt that already carries a chain", () => {
    expect(withSkillChain("Skill-Kette: task", "ignored")).toBe("Skill-Kette: task");
    expect(withSkillChain("hello", "Skill-Kette: task")).toBe("Skill-Kette: task\n\n---\nhello");
  });
});
