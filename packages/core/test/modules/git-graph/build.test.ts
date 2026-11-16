import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildGitGraph } from "../../../src/modules/git-graph/build.ts";

const execAsync = promisify(execFile);

describe("buildGitGraph (ADR-0071)", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "av-git-graph-"));
    await execAsync("git", ["-C", root, "init", "-q", "-b", "main"]);
    await execAsync("git", ["-C", root, "config", "user.email", "t@example.com"]);
    await execAsync("git", ["-C", root, "config", "user.name", "Test"]);
    await writeFile(join(root, "a.txt"), "one\n");
    await execAsync("git", ["-C", root, "add", "a.txt"]);
    await execAsync("git", ["-C", root, "commit", "-q", "-m", "first"]);
    await execAsync("git", ["-C", root, "checkout", "-q", "-b", "feature"]);
    await writeFile(join(root, "b.txt"), "two\n");
    await execAsync("git", ["-C", root, "add", "b.txt"]);
    await execAsync("git", ["-C", root, "commit", "-q", "-m", "feature work"]);
    await execAsync("git", ["-C", root, "checkout", "-q", "main"]);
    await writeFile(join(root, "c.txt"), "main\n");
    await execAsync("git", ["-C", root, "add", "c.txt"]);
    await execAsync("git", ["-C", root, "commit", "-q", "-m", "main tip"]);
    await execAsync("git", ["-C", root, "merge", "feature", "-q", "--no-ff", "-m", "merge feature"]);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("liefert Commits mit Parents, Refs und Dateien; Merge hat ≥2 Parents", async () => {
    const report = await buildGitGraph(root);
    expect(report.error).toBeUndefined();
    expect(report.commits.length).toBeGreaterThanOrEqual(3);
    const merge = report.commits.find((c) => c.subject.includes("merge"));
    expect(merge?.parents.length).toBeGreaterThanOrEqual(2);
    expect(report.branches.some((b) => b.name === "feature" || b.name.endsWith("/feature"))).toBe(true);
    const feat = report.commits.find((c) => c.subject.includes("feature work"));
    expect(feat?.files.some((f) => f.path === "b.txt")).toBe(true);
  });

  it("benennt fehlendes Repo ehrlich", async () => {
    const empty = await mkdtemp(join(tmpdir(), "av-no-git-"));
    try {
      await mkdir(join(empty, "sub"), { recursive: true });
      const report = await buildGitGraph(empty);
      expect(report.error).toMatch(/Git-Repository/i);
      expect(report.commits).toEqual([]);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});
