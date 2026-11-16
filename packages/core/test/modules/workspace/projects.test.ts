import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { stat, mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverProjects, ensureProjectDir, isProjectPathAllowed } from "../../../src/modules/workspace/projects.ts";
import { pathStyle } from "../../../src/platform/paths.ts";

/**
 * Windows ohne Entwicklermodus erlaubt keine Symlinks (EPERM). Die
 * Ausstiegs-Tests brauchen sie, der Rest nicht — also wird versucht und
 * ehrlich übersprungen statt den ganzen Block rot werden zu lassen.
 */
let symlinksWork = false;
async function trySymlink(target: string, link: string): Promise<void> {
  try {
    await symlink(target, link);
    symlinksWork = true;
  } catch {
    symlinksWork = false;
  }
}

describe("discoverProjects (T1.5-4)", () => {
  let root: string;
  let outsideDir: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "ancientvoid-projects-"));
    outsideDir = await mkdtemp(join(tmpdir(), "ancientvoid-outside-"));

    // A real git repo (has .git, has a symbolic HEAD).
    const repo = join(root, "AncientVoid");
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
    await trySymlink(outsideDir, join(root, "escape-link"));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  });

  it("lists only immediate subdirectories containing .git, not deeper ones or non-repos", async () => {
    const { projects, warnings } = await discoverProjects([root]);
    expect(warnings).toEqual([]);
    const names = projects.map((p) => p.name).sort();
    expect(names).toEqual(["AncientVoid", "custom-rag"]);
  });

  it("reads the branch from a symbolic HEAD, null for a detached one", async () => {
    const { projects } = await discoverProjects([root]);
    const mobileHub = projects.find((p) => p.name === "AncientVoid");
    const customRag = projects.find((p) => p.name === "custom-rag");
    expect(mobileHub?.branch).toBe("main");
    expect(customRag?.branch).toBeNull();
  });

  it("returns path as an absolute, directly session-creatable path", async () => {
    const { projects } = await discoverProjects([root]);
    const mobileHub = projects.find((p) => p.name === "AncientVoid");
    expect(mobileHub?.path).toBe(join(root, "AncientVoid"));
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
  let existingSub: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "ancientvoid-allow-root-"));
    outsideDir = await mkdtemp(join(tmpdir(), "ancientvoid-allow-outside-"));
    repo = join(root, "AncientVoid");
    await mkdir(join(repo, ".git"), { recursive: true });
    existingSub = join(root, "vorhanden");
    await mkdir(existingSub, { recursive: true });
    await trySymlink(outsideDir, join(root, "escape-link"));
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

  it("allows a path inside a root that does not exist yet (BUG-0161)", async () => {
    // Der Nutzer soll einen neuen Ordner in einer konfigurierten Wurzel als
    // Session-Ziel angeben koennen; vorher warf realpath und die Antwort war
    // "outside the configured projectRoots" - eine Aussage, die nicht stimmte.
    expect(await isProjectPathAllowed(join(root, "never-created"), [root])).toBe(true);
    expect(await isProjectPathAllowed(join(existingSub, "neu"), [root])).toBe(true);
  });

  it("still rejects a not-yet-existing path outside every root", async () => {
    expect(await isProjectPathAllowed(join(outsideDir, "never-created"), [root])).toBe(false);
    expect(await isProjectPathAllowed("/ganz/wo/anders", [root])).toBe(false);
  });

  it("still rejects traversal through a missing path and through a symlink out of the root", async (ctx) => {
    expect(await isProjectPathAllowed(join(root, "neu", "..", "..", "drueber-hinaus"), [root])).toBe(false);
    if (!symlinksWork) return ctx.skip();
    expect(await isProjectPathAllowed(join(root, "escape-link", "neu"), [root])).toBe(false);
  });

  it("rejects a symlink inside a root that resolves outside it (escape)", async (ctx) => {
    if (!symlinksWork) return ctx.skip();
    expect(await isProjectPathAllowed(join(root, "escape-link"), [root])).toBe(false);
  });
});

describe("ensureProjectDir (BUG-0161)", () => {
  let root: string;
  let outsideDir: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "ancientvoid-ensure-root-"));
    outsideDir = await mkdtemp(join(tmpdir(), "ancientvoid-ensure-outside-"));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  });

  it("creates one missing leaf inside a configured root", async () => {
    const ziel = join(root, "neu-der-ordner");
    const res = await ensureProjectDir(ziel, [root]);
    expect(res.created).toBe(true);
    expect(await stat(ziel).then((s) => s.isDirectory(), () => false)).toBe(true);
  });

  it("is idempotent on an existing folder", async () => {
    const ziel = join(root, "neu-der-ordner");
    expect((await ensureProjectDir(ziel, [root])).created).toBe(false);
  });

  it("refuses to build a whole tree when a parent is missing (typo-Schutz)", async () => {
    const tief = join(root, "existiert-noch-nicht", "kind");
    await expect(ensureProjectDir(tief, [root])).rejects.toThrow(/Elternordner/);
    expect(await stat(tief).then(() => true, () => false)).toBe(false);
  });

  it("refuses a target outside the configured roots", async () => {
    await expect(ensureProjectDir(join(outsideDir, "fremd"), [root])).rejects.toThrow(/au[äa]ßerhalb|projectRoots/);
  });

  it("refuses a relative path (Windows: ohne Laufwerksbuchstaben)", async () => {
    await expect(ensureProjectDir("coding/ohne-stamm", [root])).rejects.toThrow(/absolut/);
    if (pathStyle() === "win32") {
      // Der Falls in Kais data/hub.db: "/coding" wurde zu "E:\coding" (laufwerksrelativ).
      await expect(ensureProjectDir("/coding", [root])).rejects.toThrow(/absolut/);
    }
  });

  it("creates the leaf when projectRoots are unconfigured (empty) — like before", async () => {
    const ziel = join(root, "ohne-wurzeln");
    expect((await ensureProjectDir(ziel, [])).created).toBe(true);
  });
});
