import { describe, it, expect, afterAll } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectionNameFor,
  isQmdAvailable,
  indexStatus,
  ensureIndexed,
  searchProject,
  readProjectFile,
  relativeDataDir,
  removeIndex,
} from "../../../src/modules/search/search.ts";

/**
 * T3.8 (EPIC-P3 §3 "Sprachsuche"). Like ADR-0002's tmux caveat, `qmd`
 * (npm `@tobilu/qmd`) is a real, unusual external dependency — not
 * something a fresh CI runner or contributor's machine can be assumed to
 * have installed and pre-configured with cached local GGUF models. These
 * tests run for real, against the real CLI, when it's present (this
 * machine, verified 2026-09-18) and skip — not fail — otherwise.
 *
 * Every test that creates a real qmd collection cleans it up afterward —
 * this shares the user's actual local `~/.cache/qmd/index.sqlite`, not an
 * isolated fixture, so leaving test collections behind would be a real,
 * persistent side effect on their machine.
 */
const hasQmd = await isQmdAvailable();
const itQmd = hasQmd ? it : it.skip;

const projects: string[] = [];
afterAll(async () => {
  for (const p of projects) {
    await removeIndex(p).catch(() => undefined);
  }
});

async function makeTestProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "uacc-search-test-"));
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(dir, name, ".."), { recursive: true }).catch(() => undefined);
    await writeFile(join(dir, name), content, "utf8");
  }
  projects.push(dir);
  return dir;
}

describe("collectionNameFor — stable, collision-resistant, space-free", () => {
  it("is deterministic for the same path", () => {
    expect(collectionNameFor("/a/b/c")).toBe(collectionNameFor("/a/b/c"));
  });

  it("differs for different paths", () => {
    expect(collectionNameFor("/a/b/c")).not.toBe(collectionNameFor("/a/b/d"));
  });

  it("never contains a space (unlike a real user collection name can)", () => {
    expect(collectionNameFor("/a b/c")).not.toMatch(/\s/);
  });
});

describe("isQmdAvailable / indexStatus", () => {
  it("reports honestly when qmd is or isn't on PATH", async () => {
    const available = await isQmdAvailable();
    expect(typeof available).toBe("boolean");
  });

  itQmd("a never-indexed real project reports indexed:false", async () => {
    const dir = await makeTestProject({ "readme.md": "hello" });
    const status = await indexStatus(dir);
    expect(status).toEqual({ qmdAvailable: true, indexed: false });
  });
});

describe("ensureIndexed + searchProject — real qmd, real local embedding model", () => {
  itQmd(
    "indexes a small real project and finds the right file by real hybrid search",
    async () => {
      const dir = await makeTestProject({
        "banana.md": "# Banana notes\n\nThe secret banana recipe involves potassium and patience.",
        "rocket.md": "# Rocket notes\n\nOrbital mechanics require careful delta-v budgeting.",
      });

      await ensureIndexed(dir);
      expect((await indexStatus(dir)).indexed).toBe(true);

      const results = await searchProject(dir, "banana recipe potassium");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.file).toBe("banana.md");
      expect(results[0]!.line).toBeGreaterThanOrEqual(1);
      expect(typeof results[0]!.score).toBe("number");
    },
    120_000,
  );

  itQmd(
    "ensureIndexed is idempotent — a second call on an already-indexed project doesn't error",
    async () => {
      const dir = await makeTestProject({ "a.md": "content one" });
      await ensureIndexed(dir);
      await expect(ensureIndexed(dir)).resolves.toBeUndefined();
    },
    120_000,
  );

  it("searchProject against a never-indexed collection returns no results rather than throwing", async () => {
    if (!hasQmd) return;
    const dir = await makeTestProject({ "x.md": "x" });
    projects.pop(); // never indexed — nothing to remove
    const results = await searchProject(dir, "anything");
    expect(results).toEqual([]);
  });

  // BUG-0014: found running this hub against its own repo — a git
  // worktree (T2.1) nested under a project's own `dataDir` duplicates
  // every real markdown file, and qmd (no --exclude/--ignore, doesn't
  // honor .gitignore — see search.ts's top doc comment) indexes the
  // duplicate right alongside the original.
  itQmd(
    "excludeRelDirs drops worktree-duplicate hits that would otherwise appear",
    async () => {
      const dir = await makeTestProject({
        "guide.md": "# Deploy guide\n\nThe pineapple-cipher rotates every deploy.",
        "data/worktrees/session-1/guide.md": "# Deploy guide\n\nThe pineapple-cipher rotates every deploy.",
      });
      await ensureIndexed(dir);

      const unfiltered = await searchProject(dir, "pineapple cipher deploy guide", 10);
      expect(unfiltered.some((r) => r.file.startsWith("data/"))).toBe(true); // real duplicate, proves the bug is real

      const filtered = await searchProject(dir, "pineapple cipher deploy guide", 10, ["data"]);
      expect(filtered.some((r) => r.file.startsWith("data/"))).toBe(false);
      expect(filtered.some((r) => r.file === "guide.md")).toBe(true); // the real file still comes through
    },
    120_000,
  );
});

describe("relativeDataDir — BUG-0014's exclusion-path computation", () => {
  it("returns the relative path when dataDir is nested inside the project", () => {
    expect(relativeDataDir("/home/x/project", "/home/x/project/data")).toBe("data");
    expect(relativeDataDir("/home/x/project", "/home/x/project/var/data")).toBe("var/data");
  });

  it("returns undefined when dataDir is outside the project — never excludes the wrong thing", () => {
    expect(relativeDataDir("/home/x/project", "/home/x/other/data")).toBeUndefined();
    expect(relativeDataDir("/home/x/project", "/var/lib/uacc/data")).toBeUndefined();
  });

  it("returns undefined when dataDir IS the project itself — excluding '.' would drop everything", () => {
    expect(relativeDataDir("/home/x/project", "/home/x/project")).toBeUndefined();
  });

  it("does not confuse a sibling directory that merely shares a prefix", () => {
    // "/home/x/project-data" is NOT inside "/home/x/project" — a naive
    // string-prefix check without path.relative() would get this wrong.
    expect(relativeDataDir("/home/x/project", "/home/x/project-data")).toBeUndefined();
  });
});

describe("egress: UACC's own qmd invocation makes no outbound network call", () => {
  itQmd(
    "a search still succeeds with every proxy env var pointed at a dead port (real network-denial condition, not a mock)",
    async () => {
      const dir = await makeTestProject({ "note.md": "the secret word is pineapple" });
      await ensureIndexed(dir);

      const saved = {
        http_proxy: process.env.http_proxy,
        https_proxy: process.env.https_proxy,
        HTTP_PROXY: process.env.HTTP_PROXY,
        HTTPS_PROXY: process.env.HTTPS_PROXY,
      };
      process.env.http_proxy = "http://127.0.0.1:1";
      process.env.https_proxy = "http://127.0.0.1:1";
      process.env.HTTP_PROXY = "http://127.0.0.1:1";
      process.env.HTTPS_PROXY = "http://127.0.0.1:1";
      try {
        const results = await searchProject(dir, "secret pineapple word");
        expect(results.some((r) => r.file === "note.md")).toBe(true);
      } finally {
        for (const [k, v] of Object.entries(saved)) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
      }
    },
    120_000,
  );
});

describe("readProjectFile — traversal defense, size cap, real content", () => {
  it("reads a real file inside the project", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uacc-search-file-"));
    await writeFile(join(dir, "a.txt"), "line1\nline2\nline3", "utf8");
    const file = await readProjectFile(dir, "a.txt");
    expect(file).toEqual({ path: "a.txt", content: "line1\nline2\nline3", lineCount: 3 });
    await rm(dir, { recursive: true, force: true });
  });

  it("refuses a path that escapes the project directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uacc-search-file-"));
    const outside = await mkdtemp(join(tmpdir(), "uacc-search-outside-"));
    await writeFile(join(outside, "secret.txt"), "nope", "utf8");
    const file = await readProjectFile(dir, `../${outside.split("/").pop()}/secret.txt`);
    expect(file).toBeNull();
    await rm(dir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it("refuses a file over the size cap", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uacc-search-file-"));
    await writeFile(join(dir, "big.txt"), "x".repeat(1_000_001), "utf8");
    const file = await readProjectFile(dir, "big.txt");
    expect(file).toBeNull();
    await rm(dir, { recursive: true, force: true });
  });

  it("returns null for a missing file instead of throwing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uacc-search-file-"));
    expect(await readProjectFile(dir, "does-not-exist.txt")).toBeNull();
    await rm(dir, { recursive: true, force: true });
  });
});
