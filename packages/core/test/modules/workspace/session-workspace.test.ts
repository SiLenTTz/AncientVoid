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

/**
 * EPIC-P29 T29.3: der Start-Flow — Freigabe, Setup vor dem Agenten, kein
 * Start in unvorbereitetem Workspace (AC-P29-2/3), Crash-Klärung (K7/K8).
 */
describe("EPIC-P29 T29.3: SessionManager-Integration", () => {
  /** Git-Projekt mit Manifest am HEAD; Manager mit Worktrees + Approval-Queue. */
  async function fixture(tag: string, manifestContent: string, dbFile?: string) {
    const repo = await mkdtemp(join(tmpdir(), `ancientvoid-p29sm-${tag}-`));
    const out = await mkdtemp(join(tmpdir(), `ancientvoid-p29sm-${tag}-out-`));
    const eventsDir = await mkdtemp(join(tmpdir(), `ancientvoid-p29sm-${tag}-ev-`));
    const git = (...args: string[]) => execFileAsync("git", ["-C", repo, ...args]);
    await git("init", "-q", "-b", "main");
    await git("config", "user.email", "t@ancientvoid.local");
    await git("config", "user.name", "ancientvoid test");
    await writeFile(join(repo, "a.txt"), "tracked\n");
    await writeFile(join(repo, "ancientvoid.workspace.json"), manifestContent);
    await writeFile(join(repo, ".gitignore"), ".env\n");
    await git("add", "-A");
    await git("commit", "-q", "-m", "initial");

    const seen = { workdir: "", started: 0 };
    const registry = new AdapterRegistry();
    const register = (reg: AdapterRegistry) =>
      reg.register("p29-sm", () => ({
        id: "p29-sm",
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
    register(registry);
    const worktrees = new WorktreeManager(out);
    const approvals = new ApprovalService(new HubDatabase(":memory:"));
    const manager = new SessionManager(new HubDatabase(dbFile ?? ":memory:"), new EventStore(eventsDir), registry, new ProcessRunner(), undefined, worktrees, approvals);
    // Crash-Tests setzen abandoned.value = true: kein kontrolliertes
    // shutdown() (das wäre ein sanfter Stopp, kein Hard-Kill).
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

  it("ohne Freigabe: Session wartet (waiting_approval), Agent startet nicht, Prompt wird abgewiesen", async () => {
    const manifest = JSON.stringify({ schemaVersion: 1, setup: [{ id: "noop", argv: ["true"], timeoutMs: 5_000 }] });
    const f = await fixture("wait", manifest);
    try {
      const record = await f.manager.create({ adapter: "p29-sm", project: f.repo });
      expect(f.seen.started).toBe(0); // Agent startet NIE vor der Freigabe (AC-P29-2)
      expect(f.manager.get(record.id)!.status).toBe("waiting_approval");
      const request = f.approvals.list("pending").find((a) => a.sessionId === record.id && a.action === "workspace.setup");
      expect(request).toBeDefined();
      expect(request!.summary).toContain("Workspace-Manifest");
      expect(await kinds(f.manager, record.id)).toContain("workspace.approval_required");
      const steer = await f.manager.steer(record.id, { kind: "prompt", text: "jetzt aber" }, "jan");
      expect(steer.ok).toBe(false);
      expect(steer.detail).toContain("nicht bereit");
    } finally {
      await f.cleanup();
    }
  });

  it("nach Freigabe über den echten Entschied-Pfad: Setup im Worktree, Agent erst bei ready", async () => {
    const manifest = JSON.stringify({
      schemaVersion: 1,
      setup: [{ id: "schreiben", argv: ["touch", "setup-lief.txt"], timeoutMs: 10_000 }],
      include: [".env"],
    });
    const f = await fixture("approve", manifest);
    try {
      await writeFile(join(f.repo, ".env"), "KEY=wert\n");
      const record = await f.manager.create({ adapter: "p29-sm", project: f.repo, prompt: "los" });
      const request = f.approvals.list("pending").find((a) => a.sessionId === record.id)!;
      // der echte Pfad: decide (write-Klasse) → applyApproved → workspace.setup-Dispatch
      const decision = f.approvals.decide(request.id, "approve", "test-token", "jan");
      expect(decision.ok).toBe(true);
      const applied = await f.manager.applyApproved(request.id, "jan");
      expect(applied.ok).toBe(true);

      expect(f.seen.started).toBe(1);
      expect(f.seen.workdir).toBe(f.worktrees.pathFor(record.id));
      const wt = f.worktrees.pathFor(record.id);
      expect(existsSync(join(wt, "setup-lief.txt"))).toBe(true); // Setup lief wirklich im Worktree
      expect(existsSync(join(wt, ".env"))).toBe(true); // Include wurde übernommen
      expect(f.manager.get(record.id)!.status).toBe("working");
      const eventKinds = await kinds(f.manager, record.id);
      const expecting = ["workspace.approval_required", "workspace.preparing", "workspace.ready", "session.started"];
      for (const kind of expecting) expect(eventKinds).toContain(kind);
      expect(eventKinds.indexOf("workspace.ready")).toBeLessThan(eventKinds.indexOf("session.started"));
      // zweite Freigabe-Ausführung läuft nicht nochmal (ADR-0019: höchstens einmal)
      const again = await f.manager.applyApproved(request.id, "jan");
      expect(again.ok).toBe(false);
      expect(f.seen.started).toBe(1);
    } finally {
      await f.cleanup();
    }
  });

  it("Setup-Fehler: Agent startet nicht, Fehler nennt Schritt; menschlicher Retry heilt", async () => {
    const manifest = JSON.stringify({
      schemaVersion: 1,
      include: [".env"],
      setup: [{ id: "braucht-env", argv: ["test", "-f", ".env"], timeoutMs: 10_000 }],
    });
    const f = await fixture("fail", manifest);
    try {
      const record = await f.manager.create({ adapter: "p29-sm", project: f.repo });
      const request = f.approvals.list("pending").find((a) => a.sessionId === record.id)!;
      f.approvals.decide(request.id, "approve", "test-token", "jan");
      const applied = await f.manager.applyApproved(request.id, "jan");
      expect(applied.ok).toBe(false);
      expect(f.seen.started).toBe(0); // AC-P29-3: Agent nie ohne fertiges Setup
      expect(f.manager.get(record.id)!.status).toBe("error");
      const failed = (await f.manager.tail(record.id, 0)).find((e) => (e.payload as { kind?: string }).kind === "workspace.failed");
      expect(failed?.payload).toMatchObject({ failure: { step: "include" } }); // .env fehlt im Quellprojekt

      // Retry ohne Umgebungsänderung scheitert wieder — kein Selbstbetrug
      const early = await f.manager.retryWorkspaceSetup(record.id, "jan");
      expect(early.ok).toBe(false);

      // Der Mensch legt die fehlende lokale Datei an (gitignoriert), dann Retry
      await writeFile(join(f.repo, ".env"), "KEY=wert\n");
      const retry = await f.manager.retryWorkspaceSetup(record.id, "jan");
      expect(retry.ok).toBe(true);
      expect((await kinds(f.manager, record.id)).at(-1)).toBe("workspace.ready");
      expect(f.manager.get(record.id)!.status).toBe("stopped"); // steuerbar, kein Fake-working
      // Guard offen: ein neuer Start desselben (jetzt genehmigten) Projekts
      // läuft ohne erneute Freigabe durch und startet den Agenten wirklich.
      const second = await f.manager.create({ adapter: "p29-sm", project: f.repo, prompt: "zweiter" });
      expect(f.seen.started).toBe(1); // genau der zweite Start
      expect(f.manager.get(second.id)!.status).toBe("working");
      expect(await kinds(f.manager, second.id)).toContain("workspace.ready");
    } finally {
      await f.cleanup();
    }
  });

  it("ungültiges Manifest: lauter Fehlschlag ohne Freigabe-Anfrage, Agent startet nicht", async () => {
    const f = await fixture("invalid", JSON.stringify({ schemaVersion: 2 }));
    try {
      const record = await f.manager.create({ adapter: "p29-sm", project: f.repo });
      expect(f.seen.started).toBe(0);
      expect(f.manager.get(record.id)!.status).toBe("error");
      expect(f.approvals.list("pending")).toHaveLength(0);
      const failed = (await f.manager.tail(record.id, 0)).find((e) => (e.payload as { kind?: string }).kind === "workspace.failed");
      expect((failed!.payload as { failure?: { step?: string } }).failure?.step).toBe("manifest");
    } finally {
      await f.cleanup();
    }
  });

  it("Hub-Crash mitten im Setup: Recovery markiert needs_attention, kein Auto-Re-Run, Agent bleibt weg", async () => {
    const manifest = JSON.stringify({ schemaVersion: 1, setup: [{ id: "lang", argv: ["sleep", "30"], timeoutMs: 60_000 }] });
    const dbDir = await mkdtemp(join(tmpdir(), "ancientvoid-p29sm-crash-"));
    const dbPath = join(dbDir, "hub.sqlite");
    const f = await fixture("crash", manifest, dbPath);
    try {
      const record = await f.manager.create({ adapter: "p29-sm", project: f.repo });
      const request = f.approvals.list("pending").find((a) => a.sessionId === record.id)!;
      f.approvals.decide(request.id, "approve", "test-token", "jan");
      // Hard-Kill genau im Dispatch simulieren: applyApproved hatte die
      // Operation bereits auf dispatching gehoben und die Journalzeile
      // geschrieben, der Setup-Schritt (hier: sleep) lief noch — dann starb
      // der Hub. Kein shutdown() (das wäre ein sanfter Stopp).
      f.abandoned.value = true;
      const wiring = new HubDatabase(dbPath);
      wiring.prepare("UPDATE operations SET state = 'dispatching' WHERE id = ?").run(request.id);
      wiring
        .prepare("INSERT INTO workspace_operations (id, session_id, kind, state, manifest_hash, actor, created_at, updated_at) VALUES ('op-x', ?, 'setup', 'dispatching', 'x', 'jan', ?, ?)")
        .run(record.id, new Date().toISOString(), new Date().toISOString());
      wiring.close();

      const registry2 = new AdapterRegistry();
      f.register(registry2);
      const manager2 = new SessionManager(new HubDatabase(dbPath), new EventStore(f.eventsDir), registry2, new ProcessRunner(), undefined, f.worktrees, f.approvals);
      try {
        const recovered = await manager2.recoverAll();
        const eventKinds = await kinds(manager2, record.id);
        expect(recovered.recovered).toBeGreaterThan(0);
        expect(eventKinds).toContain("workspace.needs_attention");
        expect(eventKinds).not.toContain("session.started"); // kein Agent, kein zweites Setup
        expect(eventKinds.filter((k) => k === "workspace.preparing")).toHaveLength(0); // kein Auto-Re-Run
        const blocked = await manager2.steer(record.id, { kind: "prompt", text: "weiter" }, "jan");
        expect(blocked.ok).toBe(false); // Phase needs_attention blockiert
      } finally {
        await manager2.shutdown();
      }
    } finally {
      await f.cleanup();
      await rm(dbDir, { recursive: true, force: true });
    }
  });

  it("Service-Manifest: nach Freigabe laufen Setup und Service, Stop beides", async () => {
    const service = [
      "node",
      "-e",
      "require('http').createServer((q,r)=>{r.end('ws-a')}).listen(Number(process.env.ANCIENTVOID_WORKSPACE_PORT),'127.0.0.1')",
    ];
    const manifest = JSON.stringify({
      schemaVersion: 1,
      setup: [{ id: "touch", argv: ["touch", "bereit.txt"], timeoutMs: 10_000 }],
      services: [{ id: "web", argv: service, readiness: { path: "/", timeoutMs: 8_000 } }],
    });
    const f = await fixture("svc", manifest);
    try {
      const record = await f.manager.create({ adapter: "p29-sm", project: f.repo, prompt: "los" });
      const request = f.approvals.list("pending").find((a) => a.sessionId === record.id)!;
      f.approvals.decide(request.id, "approve", "test-token", "jan");
      const applied = await f.manager.applyApproved(request.id, "jan");
      expect(applied.ok).toBe(true);
      // Agent startet erst, wenn der Service bereit ist (workspace.ready danach)
      const eventKinds = await kinds(f.manager, record.id);
      expect(eventKinds).toContain("workspace.service_ready");
      expect(eventKinds.indexOf("workspace.service_ready")).toBeLessThan(eventKinds.indexOf("session.started"));
      expect(f.seen.started).toBe(1);

      const status = await f.manager.workspaceStatus(record.id);
      expect(status?.phase).toBe("ready");
      const port = status?.services[0]?.port ?? 0; // Status-API-Anker (T29.6 serviert genau das)
      expect(port).toBeGreaterThan(0);
      expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe("ws-a");

      await f.manager.stop(record.id);
      const afterStop = await kinds(f.manager, record.id);
      expect(afterStop).toContain("workspace.service_stopped");
      const probe = await fetch(`http://127.0.0.1:${port}/`).then(() => "up", () => "down");
      expect(probe).toBe("down"); // Dienst wirklich beendet
      expect(f.manager.get(record.id)!.status).toBe("stopped");
    } finally {
      await f.cleanup();
    }
  });
});
