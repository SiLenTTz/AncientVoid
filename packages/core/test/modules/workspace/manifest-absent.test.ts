import { basicFeatures, WORKSPACE_EVENT_KINDS } from "@ancientvoid/contracts";
import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore } from "../../../src/platform/eventstore.ts";
import { SessionManager } from "../../../src/modules/sessions/session-manager.ts";
import { AdapterRegistry } from "../../../src/modules/harness/registry.ts";
import { HubDatabase } from "../../../src/platform/db.ts";
import { WorktreeManager } from "../../../src/modules/workspace/worktree.ts";
import { ProcessRunner } from "@ancientvoid/workers";

const execFileAsync = promisify(execFile);

/**
 * EPIC-P29 T29.1 / ADR-0051 §7 (Migrationsregel): ohne Manifest bleibt der
 * Session-Start unverändert — der T2.1-Pfad. Diese Fixture pinnt das alte
 * Verhalten, damit T29.2+ (Manifest-Resolver, Setup, Services) es nicht
 * unbemerkt ändert; sie muss über die gesamte Epic grün bleiben (AC-P29-5).
 */
describe("EPIC-P29: altes Verhalten ohne ancientvoid.workspace.json", () => {
  async function makeGitRepo(tag: string): Promise<string> {
    const repoDir = await mkdtemp(join(tmpdir(), `ancientvoid-p29-${tag}-`));
    await execFileAsync("git", ["-C", repoDir, "init", "-q", "-b", "main"]);
    await execFileAsync("git", ["-C", repoDir, "config", "user.email", "t@ancientvoid.local"]);
    await execFileAsync("git", ["-C", repoDir, "config", "user.name", "ancientvoid test"]);
    await writeFile(join(repoDir, "a.txt"), "hi\n");
    await execFileAsync("git", ["-C", repoDir, "add", "a.txt"]);
    await execFileAsync("git", ["-C", repoDir, "commit", "-q", "-m", "initial"]);
    return repoDir;
  }

  /** Manager mit inline Adapter, der nur seinen workdir sieht (T2.1-Muster). */
  function managerWithWorktrees(outDir: string, eventsDir: string): { manager: SessionManager; seen: { workdir: string } } {
    const seen = { workdir: "" };
    const registry = new AdapterRegistry();
    registry.register("p29-fixture", () => ({
      id: "p29-fixture",
      version: "0.0.1",
      capabilities: () => ({
        reasoning: false,
        tools: false,
        cost: false,
        steer: false,
        usage: false,
        nativeDiscovery: "none",
        nativeResume: "none",
        features: basicFeatures({ followUp: false, interrupt: false }),
      }),
      async start(_spec, ctx) {
        seen.workdir = ctx.workdir;
        return { sessionId: ctx.sessionId };
      },
      async steer() {
        return { ok: true };
      },
      async status() {
        return { state: "healthy" as const };
      },
      async stop() {},
    }));
    const worktrees = new WorktreeManager(outDir);
    const manager = new SessionManager(
      new HubDatabase(":memory:"),
      new EventStore(eventsDir),
      registry,
      new ProcessRunner(),
      undefined,
      worktrees,
    );
    return { manager, seen };
  }

  it("Git-Projekt ohne Manifest: Worktree-Isolation wie seit T2.1, kein einziges workspace.*-Event", async () => {
    const repoDir = await makeGitRepo("repo");
    const outDir = await mkdtemp(join(tmpdir(), "ancientvoid-p29-out-"));
    const eventsDir = await mkdtemp(join(tmpdir(), "ancientvoid-p29-ev-"));
    const { manager, seen } = managerWithWorktrees(outDir, eventsDir);
    try {
      const record = await manager.create({ adapter: "p29-fixture", project: repoDir });
      const wtPath = new WorktreeManager(outDir).pathFor(record.id);
      expect(seen.workdir).toBe(wtPath);
      expect(record.worktreeSha).not.toBeNull();

      const events = await manager.tail(record.id, 0);
      const kinds = events.map((e) => (e.payload as { kind?: string }).kind);
      expect(kinds).not.toContain("session.no_worktree_isolation");
      for (const kind of WORKSPACE_EVENT_KINDS) {
        expect(kinds, `${kind} darf ohne Manifest nicht auftauchen`).not.toContain(kind);
      }

      await manager.stop(record.id);
      expect(existsSync(wtPath)).toBe(false);
    } finally {
      await manager.shutdown();
      await rm(repoDir, { recursive: true, force: true });
      await rm(outDir, { recursive: true, force: true });
      await rm(eventsDir, { recursive: true, force: true });
    }
  });

  it("Nicht-Git-Projekt ohne Manifest: ehrlicher Fallback mit Grund, weiterhin keine workspace.*-Events", async () => {
    const plainDir = await mkdtemp(join(tmpdir(), "ancientvoid-p29-plain-"));
    const outDir = await mkdtemp(join(tmpdir(), "ancientvoid-p29-out2-"));
    const eventsDir = await mkdtemp(join(tmpdir(), "ancientvoid-p29-ev2-"));
    const { manager } = managerWithWorktrees(outDir, eventsDir);
    try {
      const record = await manager.create({ adapter: "p29-fixture", project: plainDir });
      expect(record.worktreeSha).toBeNull();

      const events = await manager.tail(record.id, 0);
      const kinds = events.map((e) => (e.payload as { kind?: string }).kind);
      const fallback = events.find((e) => (e.payload as { kind?: string }).kind === "session.no_worktree_isolation");
      expect(fallback).toBeDefined();
      expect((fallback!.payload as { reason?: string }).reason).toBe("project is not a git repo");
      for (const kind of WORKSPACE_EVENT_KINDS) {
        expect(kinds, `${kind} darf ohne Manifest nicht auftauchen`).not.toContain(kind);
      }
    } finally {
      await manager.shutdown();
      await rm(plainDir, { recursive: true, force: true });
      await rm(outDir, { recursive: true, force: true });
      await rm(eventsDir, { recursive: true, force: true });
    }
  });
});
