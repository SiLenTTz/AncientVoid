import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceEventKind, WorkspaceManifest } from "@ancientvoid/contracts";
import { HubDatabase } from "../../../src/platform/db.ts";
import { EventStore } from "../../../src/platform/eventstore.ts";
import { ServiceSupervisor } from "../../../src/modules/workspace/workspace-services.ts";
import type { WorkspaceEmit } from "../../../src/modules/workspace/workspace-runtime.ts";

/** Echter Mini-HTTP-Service: antwortet mit `body`, hört auf den Hub-Port (Loopback). */
const httpService = (body: string): string[] => [
  "node",
  "-e",
  `require('http').createServer((q,r)=>{r.end('${body}')}).listen(Number(process.env.ANCIENTVOID_WORKSPACE_PORT),'127.0.0.1')`,
];

function collector(): { events: { kind: WorkspaceEventKind; payload: Record<string, unknown> }[]; emit: WorkspaceEmit } {
  const events: { kind: WorkspaceEventKind; payload: Record<string, unknown> }[] = [];
  return { events, emit: async (kind, payload) => void events.push({ kind, payload }) };
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 8_000, stepMs = 50): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  if (!(await check())) throw new Error("waitFor: Bedingung nicht rechtzeitig erfüllt");
}

const alive = (pid: number | null | undefined): boolean => {
  if (typeof pid !== "number") return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function rig(tag: string, dbFile?: string) {
  const dir = await mkdtemp(join(tmpdir(), `ancientvoid-p29svc-${tag}-`));
  const db = new HubDatabase(dbFile ?? ":memory:");
  const store = new EventStore(dir);
  const supervisor = new ServiceSupervisor(db, store, dir);
  const cleanup = async () => {
    await supervisor.stopAll("s1", async () => undefined).catch(() => undefined);
    await supervisor.stopAll("s2", async () => undefined).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  };
  return { dir, db, store, supervisor, cleanup };
}

describe("EPIC-P29 T29.4: ServiceSupervisor (ADR-0051 §4)", () => {
  it("startet einen Auto-Port-Service mit Readiness und stoppt ihn nachweisbar eigen", async () => {
    const f = await rig("auto");
    try {
      const { events, emit } = collector();
      const manifest: WorkspaceManifest = {
        schemaVersion: 1,
        services: [{ id: "web", argv: httpService("alpha"), readiness: { path: "/", timeoutMs: 8_000 } }],
      };
      const result = await f.supervisor.startAll({ sessionId: "s1", worktreePath: f.dir, manifest, manifestHash: "h", emit });
      expect(result.ok).toBe(true);
      const outcome = result.outcomes[0]!;
      expect(outcome.ok).toBe(true);
      expect(outcome.port).toBeGreaterThan(0);
      expect(events.map((e) => e.kind)).toContain("workspace.service_ready");

      const response = await fetch(`http://127.0.0.1:${outcome.port}/`);
      expect(await response.text()).toBe("alpha"); // echter Loopback-Dienst
      expect(f.supervisor.list("s1")[0]).toMatchObject({ service_id: "web", state: "ready" });

      await f.supervisor.stopAll("s1", emit);
      expect(alive(outcome.pid)).toBe(false);
      expect(f.supervisor.list("s1")[0]!.state).toBe("stopped");
      expect(events.map((e) => e.kind)).toContain("workspace.service_stopped");
    } finally {
      await f.cleanup();
    }
  });

  it("zwei Services laufen parallel mit getrennten Ports und eigenen Antworten (AC-P29-1-Kern)", async () => {
    const f = await rig("two");
    try {
      const { emit } = collector();
      const manifest: WorkspaceManifest = {
        schemaVersion: 1,
        services: [
          { id: "a", argv: httpService("svc-a"), readiness: { path: "/" } },
          { id: "b", argv: httpService("svc-b"), readiness: { path: "/" } },
        ],
      };
      const result = await f.supervisor.startAll({ sessionId: "s1", worktreePath: f.dir, manifest, manifestHash: "h", emit });
      expect(result.ok).toBe(true);
      const [a, b] = result.outcomes;
      expect(a!.port).not.toBe(b!.port);
      expect(await (await fetch(`http://127.0.0.1:${a!.port}/`)).text()).toBe("svc-a");
      expect(await (await fetch(`http://127.0.0.1:${b!.port}/`)).text()).toBe("svc-b");
    } finally {
      await f.cleanup();
    }
  });

  it("T29.6: Logs liefern den gekappten Schwanz pro Service; unbekannte IDs sind null", async () => {
    const f = await rig("logs");
    try {
      const { emit } = collector();
      const manifest: WorkspaceManifest = {
        schemaVersion: 1,
        services: [{ id: "noisy", argv: httpService("logsvc"), readiness: { path: "/" } }],
      };
      const result = await f.supervisor.startAll({ sessionId: "s1", worktreePath: f.dir, manifest, manifestHash: "h", emit });
      expect(result.ok).toBe(true);
      const logs = await f.supervisor.logs("s1", "noisy");
      expect(logs).not.toBeNull();
      expect(logs!.serviceId).toBe("noisy");
      expect(logs!.updatedAt).toBe(f.supervisor.list("s1")[0]!.updated_at);
      // dienst schreibt nach dem Start nichts mehr in die Logdatei — der
      // Schwanz bleibt leer, aber die Form steht (K5: nie die ganze Datei)
      expect(logs!.tail.length).toBeLessThanOrEqual(8_000);
      expect(typeof logs!.truncated).toBe("boolean");
      expect(await f.supervisor.logs("s1", "gibtsnicht")).toBeNull();
      expect(await f.supervisor.logs("andere-session", "noisy")).toBeNull();
      // gezielter Service-Zugriff (Proxy-Ziel): genau der eine, mit Port und Zustand
      expect(f.supervisor.service("s1", "noisy")).toMatchObject({ serviceId: "noisy", state: "ready" });
      expect(f.supervisor.service("s1", "noisy")!.port).toBeGreaterThan(0);
      expect(f.supervisor.service("s1", "gibtsnicht")).toBeNull();
    } finally {
      await f.cleanup();
    }
  });

  it("belegter Fixport: Fehler statt Start — der fremde Dienst bleibt unangetastet", async () => {
    const f = await rig("fixed");
    const blocker = createServer();
    const occupied = await new Promise<number>((resolve) => {
      blocker.listen(0, "127.0.0.1", () => {
        const address = blocker.address();
        resolve(typeof address === "object" && address !== null ? address.port : 0);
      });
    });
    try {
      const { emit } = collector();
      const manifest: WorkspaceManifest = {
        schemaVersion: 1,
        services: [{ id: "web", argv: httpService("egal"), port: occupied, readiness: { path: "/" } }],
      };
      const result = await f.supervisor.startAll({ sessionId: "s1", worktreePath: f.dir, manifest, manifestHash: "h", emit });
      expect(result.ok).toBe(false);
      expect(result.outcomes[0]!.failure).toMatchObject({ step: "web", kind: "port" });
      expect(f.supervisor.list("s1")).toHaveLength(0); // nie gestartet, nie angefasst
      expect(blocker.listening).toBe(true); // fremder Dienst lebt weiter (kein Kill nach Portnummer!)
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
      await f.cleanup();
    }
  });

  it("fehlende Readiness: 404 auf dem Pfad wird timeout, Log-Blob und K5-kleines Event", async () => {
    const f = await rig("ready404");
    try {
      const { events, emit } = collector();
      const argv = ["node", "-e", "require('http').createServer((q,r)=>{r.statusCode=404;r.end('nope')}).listen(Number(process.env.ANCIENTVOID_WORKSPACE_PORT),'127.0.0.1'); console.log('wohnungstuer-kodex')"];
      const manifest: WorkspaceManifest = { schemaVersion: 1, services: [{ id: "web", argv, readiness: { path: "/health", timeoutMs: 1_200 } }] };
      const result = await f.supervisor.startAll({ sessionId: "s1", worktreePath: f.dir, manifest, manifestHash: "h", emit });
      expect(result.ok).toBe(false);
      const failure = result.outcomes[0]!.failure!;
      expect(failure).toMatchObject({ step: "web", kind: "timeout" });
      expect(failure.logBlobRef).toMatch(/^sha256:/); // Log ausgelagert (K5)
      const failedEvent = events.find((e) => e.kind === "workspace.service_failed")!;
      expect(JSON.stringify(failedEvent.payload).length).toBeLessThan(4096);
      await f.supervisor.stopAll("s1", emit);
    } finally {
      await f.cleanup();
    }
  });

  it("Service ohne Readiness-Pfad gilt als bereit, wenn er am Leben bleibt; Exit davor ist ein Exit-Fehler", async () => {
    const f = await rig("alive");
    try {
      const ok = collector();
      const sleeper: WorkspaceManifest = { schemaVersion: 1, services: [{ id: "daemon", argv: ["sleep", "30"] }] };
      const first = await f.supervisor.startAll({ sessionId: "s1", worktreePath: f.dir, manifest: sleeper, manifestHash: "h", emit: ok.emit });
      expect(first.ok).toBe(true); // kein Readiness-Pfad: am Leben nach Settle = bereit

      const bad = collector();
      const quitter: WorkspaceManifest = { schemaVersion: 1, services: [{ id: "quitter", argv: ["node", "-e", "console.log('stirbt-sofort'); process.exit(3)"] }] };
      const second = await f.supervisor.startAll({ sessionId: "s2", worktreePath: f.dir, manifest: quitter, manifestHash: "h", emit: bad.emit });
      expect(second.ok).toBe(false);
      expect(second.outcomes[0]!.failure).toMatchObject({ kind: "exit" });
    } finally {
      await f.cleanup();
    }
  });

  it("fremde Prozesse werden nie beendet: Ownership-Nachweis entscheidet, nicht die Zeile", async () => {
    const f = await rig("foreign");
    const foreign = spawn("sleep", ["30"], { stdio: "ignore" });
    try {
      expect(foreign.pid).toBeDefined();
      // Abbild einer veralteten/falschen Ownership-Zeile: pid gehört uns nicht
      f.db
        .prepare(
          "INSERT INTO workspace_services (session_id, service_id, pid, argv, port, readiness_path, state, started_at, updated_at) VALUES ('s1', 'web', ?, ?, NULL, NULL, 'ready', ?, ?)",
        )
        .run(foreign.pid!, JSON.stringify(["sleep", "30"]), new Date().toISOString(), new Date().toISOString());
      const { events, emit } = collector();
      await f.supervisor.stopAll("s1", emit);
      expect(alive(foreign.pid)).toBe(true); // NIE getötet — Marker/argv passen nicht
      expect(events.find((e) => e.kind === "workspace.service_stopped")?.payload).toMatchObject({ reason: expect.stringContaining("nachweisbar") });
    } finally {
      foreign.kill("SIGKILL");
      await f.cleanup();
    }
  });

  it("K7-Adoption: Service überlebt den Hub-Neustart und wird über den Marker nachweisbar übernommen", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-p29svc-adopt-"));
    const dbFile = join(dir, "hub.sqlite");
    const first = await rig("adoptA", dbFile);
    try {
      const { emit } = collector();
      const manifest: WorkspaceManifest = {
        schemaVersion: 1,
        services: [{ id: "web", argv: httpService("adopted"), readiness: { path: "/" } }],
      };
      const started = await first.supervisor.startAll({ sessionId: "s1", worktreePath: first.dir, manifest, manifestHash: "h", emit });
      expect(started.ok).toBe(true);
      const pid = started.outcomes[0]!.pid;
      expect(alive(pid)).toBe(true);

      // "Neustart": neuer Supervisor auf derselben DB — `probing`, Adoption async
      const db2 = new HubDatabase(dbFile);
      const store2 = new EventStore(dir);
      const second = new ServiceSupervisor(db2, store2, dir);
      const events: { kind: WorkspaceEventKind; payload: Record<string, unknown> }[] = [];
      const emit2: WorkspaceEmit = async (kind, payload) => void events.push({ kind, payload });
      expect(second.reconcile("s1", emit2)).toBe(1);
      expect(second.list("s1")[0]!.state).toBe("probing"); // Restore blockiert nicht
      await waitFor(() => events.some((e) => e.kind === "workspace.service_ready"));
      expect(events.find((e) => e.kind === "workspace.service_ready")!.payload).toMatchObject({ adopted: true });
      expect(alive(pid)).toBe(true); // kein zweiter Start, derselbe Prozess
      expect(second.list("s1")[0]!.state).toBe("ready");

      await second.stopAll("s1", emit2); // neuer Supervisor darf stoppen: Eigentum bewiesen
      expect(alive(pid)).toBe(false);
      db2.close();
    } finally {
      await first.cleanup();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
