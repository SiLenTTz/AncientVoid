import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Adapter } from "@ancientvoid/contracts";
import { basicFeatures } from "@ancientvoid/contracts";
import { EventStore, HubDatabase, SessionManager, AdapterRegistry, WorktreeManager } from "../../../src/index.ts";
import { ProcessRunner } from "@ancientvoid/workers";

const git = promisify(execFile);

function idle(): Adapter {
  return {
    id: "idle",
    version: "0.0.1",
    capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures({ followUp: true, interrupt: true }) }),
    async start(_spec, ctx) {
      // One short turn, like a real CLI: the session is idle afterwards.
      await ctx.spawnWorker(["sh", "-c", "true"]);
      return { sessionId: ctx.sessionId };
    },
    async steer() {
      return { ok: true };
    },
    async status() {
      return { state: "healthy" as const };
    },
    async stop() {},
  };
}

async function setup() {
  const repo = await mkdtemp(join(tmpdir(), "ancientvoid-apply-repo-"));
  const out = await mkdtemp(join(tmpdir(), "ancientvoid-apply-wt-"));
  await git("git", ["-C", repo, "init", "-q", "-b", "main"]);
  await git("git", ["-C", repo, "config", "user.email", "dev@example.com"]);
  await git("git", ["-C", repo, "config", "user.name", "Dev"]);
  await writeFile(join(repo, "README.md"), "# Projekt\n");
  await git("git", ["-C", repo, "add", "-A"]);
  await git("git", ["-C", repo, "commit", "-q", "-m", "init"]);
  const db = new HubDatabase(":memory:");
  const registry = new AdapterRegistry();
  registry.register("idle", idle);
  const worktrees = new WorktreeManager(out);
  const manager = new SessionManager(db, new EventStore(out), registry, new ProcessRunner(), undefined, worktrees);
  const record = await manager.create({ adapter: "idle", project: repo, prompt: "Baue die Punkteanzeige" }, "pc");
  const wt = worktrees.pathFor(record.id);
  const deadline = Date.now() + 5000;
  while (manager.get(record.id)?.status !== "idle" && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  const cleanup = async () => {
    await manager.shutdown();
    await rm(repo, { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
  };
  return { repo, wt, manager, id: record.id, cleanup };
}

describe("apply a session's work to the project", () => {
  it("commits the worktree and merges it into the checked-out branch", async () => {
    const s = await setup();
    try {
      await writeFile(join(s.wt, "score.js"), "export const score = 0;\n");
      await writeFile(join(s.wt, "README.md"), "# Projekt\n\nMit Punkten.\n");
      const result = await s.manager.applyToProject(s.id, "pc");
      expect(result).toMatchObject({ ok: true, into: "main", files: 2 });
      expect(await readFile(join(s.repo, "score.js"), "utf8")).toContain("score");
      const { stdout: log } = await git("git", ["-C", s.repo, "log", "--format=%s", "-3"]);
      expect(log).toContain("Baue die Punkteanzeige");
      const { stdout: wtStatus } = await git("git", ["-C", s.wt, "status", "--porcelain"]);
      expect(wtStatus.trim()).toBe("");
      const events = await s.manager.tail(s.id, 0);
      expect(events.some((e) => (e.payload as { kind?: string }).kind === "session.applied")).toBe(true);
      expect(existsSync(s.wt)).toBe(true);
    } finally {
      await s.cleanup();
    }
  });

  it("refuses when the project folder has unsaved changes", async () => {
    const s = await setup();
    try {
      await writeFile(join(s.wt, "score.js"), "x\n");
      await writeFile(join(s.repo, "notiz.txt"), "meins\n");
      const result = await s.manager.applyToProject(s.id);
      expect(result.ok).toBe(false);
      expect((result as { detail: string }).detail).toContain("notiz.txt");
      expect(existsSync(join(s.repo, "score.js"))).toBe(false);
    } finally {
      await s.cleanup();
    }
  });

  it("aborts a conflicting merge and names the file", async () => {
    const s = await setup();
    try {
      await writeFile(join(s.wt, "README.md"), "# Session-Version\n");
      await writeFile(join(s.repo, "README.md"), "# Meine Version\n");
      await git("git", ["-C", s.repo, "commit", "-q", "-am", "mine"]);
      const result = await s.manager.applyToProject(s.id);
      expect(result.ok).toBe(false);
      expect((result as { detail: string }).detail).toMatch(/Konflikt.*README\.md/);
      expect(await readFile(join(s.repo, "README.md"), "utf8")).toBe("# Meine Version\n");
      const { stdout } = await git("git", ["-C", s.repo, "status", "--porcelain"]);
      expect(stdout.trim()).toBe("");
    } finally {
      await s.cleanup();
    }
  });

  it("says so when there is nothing to apply", async () => {
    const s = await setup();
    try {
      expect(await s.manager.applyToProject(s.id)).toEqual({ ok: false, detail: "Keine Änderungen zum Übernehmen." });
    } finally {
      await s.cleanup();
    }
  });
});
