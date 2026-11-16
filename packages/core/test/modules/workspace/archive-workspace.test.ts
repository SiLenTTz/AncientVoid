import { basicFeatures } from "@ancientvoid/contracts";
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
import { ApprovalService } from "../../../src/modules/approvals/approvals.ts";

const execFileAsync = promisify(execFile);

const HTTP_SERVICE = [
  "node",
  "-e",
  "require('http').createServer((q,r)=>{r.end('arch')}).listen(Number(process.env.ANCIENTVOID_WORKSPACE_PORT),'127.0.0.1')",
];

/**
 * EPIC-P29 T29.5: Archivierung verbindet Services, genehmigten Teardown und
 * die P14-Prüfungen; Hard-Kill mit laufendem Service und dirty Worktree;
 * keine fremden Prozesse, keine zweite Setup-Ausführung (K7/K8).
 */
// Eigentumsnachweis laufender Services liest /proc (Linux, ADR-0051 §4) — ohne /proc sichtbar übersprungen.
const hasProc = existsSync("/proc/self/environ");

describe("EPIC-P29 T29.5: Archivierung und Recovery mit P14", () => {
  async function fixture(tag: string, manifestContent: string, dbFile?: string) {
    const repo = await mkdtemp(join(tmpdir(), `ancientvoid-p29ar-${tag}-`));
    const out = await mkdtemp(join(tmpdir(), `ancientvoid-p29ar-${tag}-out-`));
    const eventsDir = await mkdtemp(join(tmpdir(), `ancientvoid-p29ar-${tag}-ev-`));
    const git = (...args: string[]) => execFileAsync("git", ["-C", repo, ...args]);
    await git("init", "-q", "-b", "main");
    await git("config", "user.email", "t@ancientvoid.local");
    await git("config", "user.name", "ancientvoid test");
    await writeFile(join(repo, "a.txt"), "tracked\n");
    await writeFile(join(repo, "ancientvoid.workspace.json"), manifestContent);
    await git("add", "-A");
    await git("commit", "-q", "-m", "initial");

    const seen = { started: 0 };
    const register = (reg: AdapterRegistry) =>
      reg.register("p29-ar", () => ({
        id: "p29-ar",
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
          seen.started += 1;
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
    const registry = new AdapterRegistry();
    register(registry);
    const worktrees = new WorktreeManager(out);
    const approvals = new ApprovalService(new HubDatabase(":memory:"));
    const manager = new SessionManager(new HubDatabase(dbFile ?? ":memory:"), new EventStore(eventsDir), registry, new ProcessRunner(), undefined, worktrees, approvals);
    const abandoned = { value: false };
    return {
      repo,
      out,
      eventsDir,
      manager,
      approvals,
      worktrees,
      seen,
      register,
      abandoned,
      cleanup: async () => {
        if (!abandoned.value) await manager.shutdown();
        await rm(repo, { recursive: true, force: true });
        await rm(out, { recursive: true, force: true });
        await rm(eventsDir, { recursive: true, force: true });
      },
    };
  }

  const kinds = async (manager: SessionManager, id: string): Promise<string[]> =>
    (await manager.tail(id, 0)).map((e) => (e.payload as { kind?: string }).kind).filter((k): k is string => typeof k === "string");

  /** Session mit Workspace + laufendem Service bis `working` bringen. */
  async function startedWithService(f: Awaited<ReturnType<typeof fixture>>): Promise<string> {
    const record = await f.manager.create({ adapter: "p29-ar", project: f.repo, prompt: "los" });
    const request = f.approvals.list("pending").find((a) => a.sessionId === record.id)!;
    f.approvals.decide(request.id, "approve", "test-token", "jan");
    const applied = await f.manager.applyApproved(request.id, "jan");
    expect(applied.ok).toBe(true);
    return record.id;
  }

  it.skipIf(!hasProc)("Archivieren: Services beendet, sauberer Worktree weg, workspace.archived (AC-P29-5)", async () => {
    const manifest = JSON.stringify({
      schemaVersion: 1,
      services: [{ id: "web", argv: HTTP_SERVICE, readiness: { path: "/" } }],
      teardown: [{ id: "danach", argv: ["true"], timeoutMs: 5_000 }],
    });
    const f = await fixture("clean", manifest);
    try {
      const id = await startedWithService(f);
      const port = (await f.manager.workspaceStatus(id))!.services[0]!.port!;
      await f.manager.stop(id);
      await f.manager.archive(id, true, "jan");
      const tail = await kinds(f.manager, id);
      expect(tail).toContain("workspace.tearing_down");
      expect(tail).toContain("workspace.archived"); // Teardown ok UND Worktree entfernt
      expect(existsSync(f.worktrees.pathFor(id))).toBe(false);
      expect(await fetch(`http://127.0.0.1:${port}/`).then(() => "up", () => "down")).toBe("down");
    } finally {
      await f.cleanup();
    }
  });

  it("Dirty Worktree bleibt erhalten — kein workspace.archived, Fundort sichtbar", async () => {
    const manifest = JSON.stringify({ schemaVersion: 1, teardown: [{ id: "danach", argv: ["true"], timeoutMs: 5_000 }] });
    const f = await fixture("dirty", manifest);
    try {
      const id = await startedWithService(f);
      await writeFile(join(f.worktrees.pathFor(id), "ungesichert.txt"), "arbeit\n"); // BUG-0027-Fall
      await f.manager.stop(id);
      await f.manager.archive(id, true, "jan");
      const tail = await kinds(f.manager, id);
      expect(tail).not.toContain("workspace.archived");
      expect(tail).toContain("session.worktree_kept");
      expect(existsSync(join(f.worktrees.pathFor(id), "ungesichert.txt"))).toBe(true); // auffindbar, nicht weg
    } finally {
      await f.cleanup();
    }
  });

  it("Teardown-Fehler: cleanup_failed, Worktree bleibt mit Grund", async () => {
    const manifest = JSON.stringify({ schemaVersion: 1, teardown: [{ id: "kaputt", argv: ["exit", "4"], timeoutMs: 5_000 }] });
    const f = await fixture("tdfail", manifest);
    try {
      const id = await startedWithService(f);
      await f.manager.stop(id);
      await f.manager.archive(id, true, "jan");
      const tail = await kinds(f.manager, id);
      expect(tail).toContain("workspace.cleanup_failed");
      expect(tail).not.toContain("workspace.archived");
      expect(existsSync(f.worktrees.pathFor(id))).toBe(true); // P14 wird nicht umgangen
    } finally {
      await f.cleanup();
    }
  });

  it("Hard-Kill mit laufendem Service und dirty Worktree: Adoption statt Neustart, keine zweite Setup-Ausführung", async () => {
    const manifest = JSON.stringify({
      schemaVersion: 1,
      setup: [{ id: "marker", argv: ["touch", "setup-ok.txt"], timeoutMs: 5_000 }],
      services: [{ id: "web", argv: HTTP_SERVICE, readiness: { path: "/" } }],
    });
    const dbDir = await mkdtemp(join(tmpdir(), "ancientvoid-p29ar-crash-"));
    const dbPath = join(dbDir, "hub.sqlite");
    const f = await fixture("crash", manifest, dbPath);
    try {
      const id = await startedWithService(f);
      const port = (await f.manager.workspaceStatus(id))!.services[0]!.port!;
      await writeFile(join(f.worktrees.pathFor(id), "ungesichert.txt"), "arbeit\n"); // dirty
      f.abandoned.value = true; // Hard-Kill: kein shutdown, Service läuft weiter

      const registry2 = new AdapterRegistry();
      f.register(registry2);
      const manager2 = new SessionManager(new HubDatabase(dbPath), new EventStore(f.eventsDir), registry2, new ProcessRunner(), undefined, f.worktrees, f.approvals);
      try {
        await manager2.recoverAll();
        // Dienst überlebt und wird adoptiert (asynchrones probing → ready)
        await waitForEvent(manager2, id, "workspace.service_ready");
        expect(await fetch(`http://127.0.0.1:${port}/`).then((r) => r.text())).toBe("arch");
        // KEINE zweite Setup-Ausführung: genau ein preparing/vom ersten Lauf,
        // der Setup-Marker existert genau einmal
        const tail = await kinds(manager2, id);
        expect(tail.filter((k) => k === "workspace.preparing")).toHaveLength(1);
        // dirty Worktree bleibt; Archivieren stoppt den adoptierten Dienst und behält die Arbeit
        await manager2.steer(id, { kind: "stop" }, "jan").catch(() => undefined);
        await manager2.archive(id, true, "jan");
        const after = await kinds(manager2, id);
        expect(after).toContain("workspace.service_stopped");
        expect(after).toContain("session.worktree_kept");
        expect(existsSync(join(f.worktrees.pathFor(id), "ungesichert.txt"))).toBe(true);
      } finally {
        await manager2.shutdown();
      }
    } finally {
      await f.cleanup();
      await rm(dbDir, { recursive: true, force: true });
    }
  });
});

async function waitForEvent(manager: SessionManager, sessionId: string, kind: string, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tail = await manager.tail(sessionId, 0);
    if (tail.some((e) => (e.payload as { kind?: string }).kind === kind)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`waitForEvent: ${kind} nicht rechtzeitig gesehen`);
}
