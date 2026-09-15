import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverProjects, isProjectPathAllowed } from "../src/projects.ts";

describe("discoverProjects (T1.5-4)", () => {
  let root: string;
  let outsideDir: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "uacc-projects-"));
    outsideDir = await mkdtemp(join(tmpdir(), "uacc-outside-"));

    // A real git repo (has .git, has a symbolic HEAD).
    const repo = join(root, "mobile-hub");
    await mkdir(join(repo, ".git"), { recursive: true });
    await writeFile(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");

    // A second real repo, detached HEAD (no "ref:" line).
    const repo2 = join(root, "custom-rag");
    await mkdir(join(repo2, ".git"), { recursive: true });
    await writeFile(join(repo2, ".git", "HEAD"), "abcdef1234567890\n");

    // A non-repo directory at the same depth — must NOT be listed.
    await mkdir(join(root, "not-a-repo"), { recursive: true });

    // A repo one level deeper — depth 1 only, must NOT be listed.
    const nested = join(root, "not-a-repo", "nested-repo", ".git");
    await mkdir(nested, { recursive: true });

    // A plain file at root level (not a directory) — must be skipped, not thrown on.
    await writeFile(join(root, "a-file.txt"), "not a directory");

    // A symlink inside root pointing OUTSIDE root, for the escape test.
    await symlink(outsideDir, join(root, "escape-link"));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  });

  it("lists only immediate subdirectories containing .git, not deeper ones or non-repos", async () => {
    const { projects, warnings } = await discoverProjects([root]);
    expect(warnings).toEqual([]);
    const names = projects.map((p) => p.name).sort();
    expect(names).toEqual(["custom-rag", "mobile-hub"]);
  });

  it("reads the branch from a symbolic HEAD, null for a detached one", async () => {
    const { projects } = await discoverProjects([root]);
    const mobileHub = projects.find((p) => p.name === "mobile-hub");
    const customRag = projects.find((p) => p.name === "custom-rag");
    expect(mobileHub?.branch).toBe("main");
    expect(customRag?.branch).toBeNull();
  });

  it("returns path as an absolute, directly session-creatable path", async () => {
    const { projects } = await discoverProjects([root]);
    const mobileHub = projects.find((p) => p.name === "mobile-hub");
    expect(mobileHub?.path).toBe(join(root, "mobile-hub"));
  });

  it("warns (not crashes, not a silent empty result) on a non-existent root", async () => {
    const { projects, warnings } = await discoverProjects([join(root, "does-not-exist")]);
    expect(projects).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("does-not-exist");
  });
});

describe("isProjectPathAllowed (T1.5-4, AC-P1.5-5)", () => {
  let root: string;
  let outsideDir: string;
  let repo: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "uacc-allow-root-"));
    outsideDir = await mkdtemp(join(tmpdir(), "uacc-allow-outside-"));
    repo = join(root, "mobile-hub");
    await mkdir(join(repo, ".git"), { recursive: true });
    await symlink(outsideDir, join(root, "escape-link"));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  });

  it("allows any path when projectRoots is unconfigured (empty) — preserves pre-T1.5-4 behavior", async () => {
    expect(await isProjectPathAllowed("/anything/at/all", [])).toBe(true);
  });

  it("allows a real path inside a configured root", async () => {
    expect(await isProjectPathAllowed(repo, [root])).toBe(true);
  });

  it("rejects a path outside every configured root", async () => {
    expect(await isProjectPathAllowed(outsideDir, [root])).toBe(false);
  });

  it("rejects a symlink inside a root that resolves outside it (escape)", async () => {
    expect(await isProjectPathAllowed(join(root, "escape-link"), [root])).toBe(false);
  });

  it("rejects a path that doesn't exist at all", async () => {
    expect(await isProjectPathAllowed(join(root, "never-created"), [root])).toBe(false);
  });
});
