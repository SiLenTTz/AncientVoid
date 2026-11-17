import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
import { readFile, mkdir } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import type { WorkspaceFailure, WorkspaceManifest, WorkspaceService, WorkspaceServiceState } from "@ancientvoid/contracts";
import { WORKSPACE_LOGS_TAIL_CHARS, WORKSPACE_OWNERSHIP_ENV, WORKSPACE_SERVICE_PORT_ENV, spawnArgv } from "@ancientvoid/contracts";
import type { HubDatabase } from "../../platform/db.ts";
import type { EventStore } from "../../platform/eventstore.ts";
import type { WorkspaceEmit } from "./workspace-runtime.ts";

/**
 * EPIC-P29 T29.4 / ADR-0051 §4: verwaltete Services eines Workspaces.
 *
 * - Dienste binden an Loopback; Auto-Port vergibt der Hub (begrenztes Retry
 *   beim Bind-Race der Vergabe), Fixport-Kollision ist ein Fehler — fremde
 *   Prozesse werden NIE beendet, die Portnummer ist kein Eigentumsnachweis.
 * - Eigentum = pid + argv + Umgebungsmarker `ANCIENTVOID_WORKSPACE_SESSION_ID`
 *   (Lesung über /proc, Linux). Nicht nachweisbar eigener Besitz wird weder
 *   adoptiert noch angefasst (fail safe).
 * - Prozesse laufen detached mit Datendatei-Logs — sie überleben einen
 *   Hub-Crash und werden nach dem Restore als `probing` adoptiert (K7:
 *   blockiert den Restore nicht, Probes laufen asynchron).
 */

const PROBE_INTERVAL_MS = 250;
const ALIVE_SETTLE_MS = 500;
const STOP_GRACE_MS = 3_000;
const ALLOC_RETRIES = 3;
/** Begrenzte Logs: der Schwanz, der in Events/Blobs geht (K5). */
const LOG_TAIL_BYTES = 8 * 1024;

export interface ServiceStartContext {
  sessionId: string;
  worktreePath: string;
  manifest: WorkspaceManifest;
  manifestHash: string;
  emit: WorkspaceEmit;
}

export interface ServiceOutcome {
  serviceId: string;
  ok: boolean;
  port: number | null;
  pid: number | null;
  failure?: WorkspaceFailure;
}

interface ServiceRow {
  session_id: string;
  service_id: string;
  pid: number;
  argv: string;
  port: number | null;
  readiness_path: string | null;
  state: string;
  started_at: string;
  updated_at: string;
}

export class ServiceSupervisor {
  private readonly db: HubDatabase;
  private readonly store: EventStore;
  private readonly baseDir: string;

  constructor(db: HubDatabase, store: EventStore, baseDir: string) {
    this.db = db;
    this.store = store;
    this.baseDir = baseDir;
  }

  /** Startet alle Manifest-Services nacheinander; das Ergebnis fasst jeden Einzelnen zusammen. */
  async startAll(ctx: ServiceStartContext): Promise<{ ok: boolean; outcomes: ServiceOutcome[] }> {
    const outcomes: ServiceOutcome[] = [];
    let ok = true;
    for (const service of ctx.manifest.services ?? []) {
      const outcome = await this.startOne(ctx, service);
      outcomes.push(outcome);
      if (!outcome.ok) ok = false;
    }
    return { ok, outcomes };
  }

  /** Beendet nur nachweisbar eigene Prozesse (SIGTERM, nach Frist SIGKILL). */
  async stopAll(sessionId: string, emit: WorkspaceEmit): Promise<number> {
    let stopped = 0;
    for (const row of this.list(sessionId)) {
      const alive = await this.isOwnedAlive(row);
      if (alive) {
        process.kill(row.pid, "SIGTERM");
        const exited = await this.waitExit(row.pid, STOP_GRACE_MS);
        if (!exited) {
          if (await this.isOwnedAlive(row)) process.kill(row.pid, "SIGKILL"); // noch immer nachweisbar unseres
          await this.waitExit(row.pid, 2_000);
        }
        stopped += 1;
      }
      this.setServiceState(row.session_id, row.service_id, "stopped");
      await emit("workspace.service_stopped", { serviceId: row.service_id, pid: row.pid, port: row.port, ...(alive ? {} : { reason: "Prozess nicht mehr nachweisbar eigen" }) });
    }
    return stopped;
  }

  /**
   * K7-Restore: markiert jeden Service `probing` und prüft asynchron weiter
   * (Adoption + Readiness) — der Restore selbst wartet nicht. Rückgabe =
   * Anzahl übernommener Prüfungen.
   */
  reconcile(sessionId: string, emit: WorkspaceEmit): number {
    const rows = this.list(sessionId);
    for (const row of rows) {
      this.setServiceState(row.session_id, row.service_id, "probing");
      void (async () => {
        if (!(await this.isOwnedAlive(row))) {
          this.setServiceState(row.session_id, row.service_id, "stopped");
          await emit("workspace.service_stopped", { serviceId: row.service_id, pid: row.pid, port: row.port, reason: "nach Neustart nicht mehr nachweisbar eigen" });
          return;
        }
        const failure = row.readiness_path
          ? row.port === null
            ? { kind: "port" as const, detail: "Port unbekannt — Readiness nicht prüfbar" }
            : await this.probe(row.pid, row.port, row.readiness_path, 15_000)
          : null;
        if (failure) {
          this.setServiceState(row.session_id, row.service_id, "failed");
          await emit("workspace.service_failed", { serviceId: row.service_id, failure, port: row.port, pid: row.pid });
          return;
        }
        this.setServiceState(row.session_id, row.service_id, "ready");
        await emit("workspace.service_ready", { serviceId: row.service_id, port: row.port, pid: row.pid, adopted: true });
      })().catch(() => undefined);
    }
    return rows.length;
  }

  list(sessionId: string): ServiceRow[] {
    return this.db
      .prepare("SELECT * FROM workspace_services WHERE session_id = ? ORDER BY service_id")
      .all(sessionId) as unknown as ServiceRow[];
  }

  /** Genau ein registrierter Service (T29.6: Proxy-Ziel — Port aus der Zeile, nie aus einem Request). */
  service(sessionId: string, serviceId: string): { serviceId: string; state: string; port: number | null; pid: number | null } | null {
    const row = this.list(sessionId).find((r) => r.service_id === serviceId);
    if (!row) return null;
    return { serviceId: row.service_id, state: row.state, port: row.port, pid: row.pid };
  }

  /** T29.6: gekappter Log-Schwanz eines Service (K5) — null, wenn es die Zeile nicht gibt. */
  async logs(sessionId: string, serviceId: string): Promise<{ serviceId: string; tail: string; truncated: boolean; updatedAt: string } | null> {
    const row = this.list(sessionId).find((r) => r.service_id === serviceId);
    if (!row) return null;
    const raw = await this.readTail(sessionId, serviceId, WORKSPACE_LOGS_TAIL_CHARS * 4);
    return {
      serviceId,
      tail: raw.length > WORKSPACE_LOGS_TAIL_CHARS ? raw.slice(-WORKSPACE_LOGS_TAIL_CHARS) : raw,
      truncated: raw.length > WORKSPACE_LOGS_TAIL_CHARS,
      updatedAt: row.updated_at,
    };
  }

  private async startOne(ctx: ServiceStartContext, service: WorkspaceService): Promise<ServiceOutcome> {
    const argv = service.argv;
    const fixed = service.port !== undefined && service.port !== "auto" ? service.port : null;
    if (fixed !== null && !(await this.isLoopbackFree(fixed))) {
      const failure: WorkspaceFailure = { step: service.id, kind: "port", detail: `Fixport ${fixed} ist belegt — fremde Prozesse werden nie beendet`, logBlobRef: null };
      await ctx.emit("workspace.service_failed", { serviceId: service.id, failure, port: fixed, pid: null });
      return { serviceId: service.id, ok: false, port: fixed, pid: null, failure };
    }
    const port = fixed !== null ? fixed : await this.allocateAutoPort();
    if (port === null) {
      const failure: WorkspaceFailure = { step: service.id, kind: "port", detail: "kein freier Auto-Port verfügbar", logBlobRef: null };
      await ctx.emit("workspace.service_failed", { serviceId: service.id, failure, port: null, pid: null });
      return { serviceId: service.id, ok: false, port: null, pid: null, failure };
    }

    const logFile = await this.logFileFor(ctx.sessionId, service.id);
    const logFd = await open(logFile, "a").catch(() => null);
    const stdio: ("ignore" | number)[] = ["ignore", logFd ? logFd.fd : "ignore", logFd ? logFd.fd : "ignore"];
    const start = spawnArgv(argv[0]!, argv.slice(1));
    const child = spawn(start.file, start.args, {
      cwd: ctx.worktreePath,
      env: { ...process.env, [WORKSPACE_OWNERSHIP_ENV]: ctx.sessionId, [WORKSPACE_SERVICE_PORT_ENV]: String(port) },
      detached: true, // überlebt einen Hub-Crash (K7-Adoption über den Marker)
      stdio,
      ...(start.shell ? { shell: true } : {}),
    });
    child.unref();
    await logFd?.close().catch(() => undefined);
    if (child.pid === undefined) {
      const failure: WorkspaceFailure = { step: service.id, kind: "exit", detail: "Prozessstart fehlgeschlagen", logBlobRef: null };
      await ctx.emit("workspace.service_failed", { serviceId: service.id, failure, port, pid: null });
      return { serviceId: service.id, ok: false, port, pid: null, failure };
    }
    const pid = child.pid;
    this.persistRow(ctx.sessionId, service.id, pid, argv, port, service.readiness?.path ?? null, "starting");

    const probeTimeout = service.readiness?.timeoutMs ?? 15_000;
    const raw = service.readiness
      ? await this.probe(pid, port, service.readiness.path, probeTimeout)
      : await this.aliveAfterSettle(pid);
    if (raw !== null) {
      const failure = await this.withLog(ctx.sessionId, service.id, { step: service.id, logBlobRef: null, ...raw });
      this.setServiceState(ctx.sessionId, service.id, "failed");
      await ctx.emit("workspace.service_failed", { serviceId: service.id, failure, port, pid });
      return { serviceId: service.id, ok: false, port, pid, failure };
    }
    this.setServiceState(ctx.sessionId, service.id, "ready");
    await ctx.emit("workspace.service_ready", { serviceId: service.id, port, pid });
    return { serviceId: service.id, ok: true, port, pid };
  }

  /** Readiness: HTTP 2xx/3xx auf dem Loopback-Pfad, bis die Frist abläuft; Exit vorher ist ein Exit-Fehler. */
  private async probe(pid: number, port: number, path: string, timeoutMs: number): Promise<{ kind: "exit" | "timeout"; detail: string; exitCode?: number } | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!this.alive(pid)) return { kind: "exit", detail: "Prozess vor Readiness beendet" };
      try {
        const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(2_000) });
        if (response.status < 400) return null;
      } catch {
        // noch nicht erreichbar — weiter pollen
      }
      await sleep(PROBE_INTERVAL_MS);
    }
    return { kind: "timeout", detail: `Readiness ${path} nicht erreicht` };
  }

  private async aliveAfterSettle(pid: number): Promise<{ kind: "exit"; detail: string } | null> {
    await sleep(ALIVE_SETTLE_MS);
    return this.alive(pid) ? null : { kind: "exit", detail: "Prozess lief nach dem Start nicht weiter" };
  }

  /** Hängt den gekappten Log-Schwanz als Blob an (K5: Events bleiben klein). */
  private async withLog(sessionId: string, serviceId: string, failure: WorkspaceFailure): Promise<WorkspaceFailure> {
    const tail = await this.logTail(sessionId, serviceId).catch(() => "");
    if (tail.trim() === "") return failure;
    const blob = await this.store.writeBlob(sessionId, tail);
    return { ...failure, detail: tail.slice(-200).trim().slice(0, 500) || failure.detail, logBlobRef: `sha256:${blob.hash}` };
  }

  private async logTail(sessionId: string, serviceId?: string): Promise<string> {
    const rows = serviceId ? this.list(sessionId).filter((r) => r.service_id === serviceId) : this.list(sessionId);
    if (rows.length === 0) return "";
    return this.readTail(sessionId, rows[0]!.service_id, LOG_TAIL_BYTES);
  }

  /** Liest die letzten `bytes` Bytes der Logdatei eines Service (utf8, gekappt). */
  private async readTail(sessionId: string, serviceId: string, bytes: number): Promise<string> {
    const file = await this.logFileFor(sessionId, serviceId);
    const fd = await open(file, "r").catch(() => null);
    if (!fd) return "";
    try {
      const size = (await fd.stat()).size;
      const start = Math.max(0, size - bytes);
      const buffer = Buffer.alloc(size - start);
      await fd.read(buffer, 0, buffer.length, start);
      return buffer.toString("utf8");
    } finally {
      await fd.close();
    }
  }

  /** Auto-Port: kurz binden, Port merken, wieder freigeben — mit begrenztem Retry. */
  private async allocateAutoPort(): Promise<number | null> {
    for (let attempt = 0; attempt < ALLOC_RETRIES; attempt++) {
      const port = await new Promise<number | null>((resolve) => {
        const server = createServer();
        server.once("error", () => resolve(null));
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          const picked = typeof address === "object" && address !== null ? address.port : null;
          server.close(() => resolve(picked));
        });
      });
      if (port !== null && (await this.isLoopbackFree(port))) return port; // Bind-Race-Nachtest
    }
    return null;
  }

  private isLoopbackFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server: Server = createServer();
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
    });
  }

  private alive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /** Eigentumsnachweis: pid lebt, argv stimmt, Umgebungsmarker stimmt (Linux /proc). */
  private async isOwnedAlive(row: ServiceRow): Promise<boolean> {
    if (!this.alive(row.pid)) return false;
    try {
      const env = await readFile(`/proc/${row.pid}/environ`);
      if (!env.includes(Buffer.from(`${WORKSPACE_OWNERSHIP_ENV}=${row.session_id}\0`))) return false;
      const cmdline = (await readFile(`/proc/${row.pid}/cmdline`, "utf8")).split("\0").filter(Boolean);
      return cmdline.join(" ") === (JSON.parse(row.argv) as string[]).join(" ");
    } catch {
      return false; // nicht beweisbar ⇒ nie anfassen (fail safe)
    }
  }

  private waitExit(pid: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve) => {
      const timer = setInterval(() => {
        if (!this.alive(pid)) {
          clearInterval(timer);
          resolve(true);
        } else if (Date.now() > deadline) {
          clearInterval(timer);
          resolve(false);
        }
      }, 100);
    });
  }

  private persistRow(sessionId: string, serviceId: string, pid: number, argv: readonly string[], port: number, readinessPath: string | null, state: WorkspaceServiceState | string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO workspace_services (session_id, service_id, pid, argv, port, readiness_path, state, started_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, service_id) DO UPDATE SET pid = excluded.pid, argv = excluded.argv, port = excluded.port, readiness_path = excluded.readiness_path, state = excluded.state, updated_at = excluded.updated_at`,
      )
      .run(sessionId, serviceId, pid, JSON.stringify(argv), port, readinessPath, state, now, now);
  }

  private setServiceState(sessionId: string, serviceId: string, state: WorkspaceServiceState | string): void {
    this.db
      .prepare("UPDATE workspace_services SET state = ?, updated_at = ? WHERE session_id = ? AND service_id = ?")
      .run(state, new Date().toISOString(), sessionId, serviceId);
  }

  private async logFileFor(sessionId: string, serviceId: string): Promise<string> {
    const dir = join(this.baseDir, "services", sessionId);
    await mkdir(dir, { recursive: true });
    return join(dir, `${serviceId}.log`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
