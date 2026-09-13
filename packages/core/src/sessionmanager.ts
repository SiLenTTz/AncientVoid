import { randomUUID, createHash } from "node:crypto";
import type {
  Adapter,
  AdapterContext,
  BlobRef,
  EmittedEvent,
  NormalizedEvent,
  SessionHandle,
  SessionRecord,
  SessionSnapshot,
  SessionStatus,
  SteerInput,
  Ack,
  WorkerRunner,
} from "@uacc/contracts";
import { SessionSpec as SessionSpecSchema } from "@uacc/contracts";
import type { EventStore } from "./eventstore.ts";
import type { AdapterRegistry } from "./registry.ts";
import type { HubDatabase } from "./db.ts";

/**
 * Session lifecycle manager.
 *
 * - Sessions are first-class objects persisted in SQLite + JSONL.
 * - Every state change is emitted as a system event (auditable).
 * - K7 crash recovery: replay JSONL + snapshot + optional adapter.recover().
 * - Adapters only ever see AdapterContext — never hub internals.
 */

interface LiveSession {
  record: SessionRecord;
  adapter: Adapter;
  handle: SessionHandle | null;
  abort: AbortController;
  subscribers: Set<(events: NormalizedEvent[]) => void>;
}

/** Raw SQLite row shape (snake_case) for the sessions table. */
interface SessionRow {
  id: string;
  adapter: string;
  project: string;
  worktree_sha: string | null;
  model: string | null;
  status: string;
  created_at: string;
  budget_usd: number | null;
  adapter_version: string;
  last_seq: number;
}

function rowToRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    adapter: row.adapter,
    project: row.project,
    worktreeSha: row.worktree_sha,
    model: row.model,
    status: row.status as SessionRecord["status"],
    createdAt: row.created_at,
    budgetUsd: row.budget_usd,
    adapterVersion: row.adapter_version,
    lastSeq: row.last_seq,
  };
}

const VALID_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  idle: ["working", "waiting_approval", "parked", "stopping", "stopped", "error"],
  starting: ["working", "idle", "waiting_approval", "error", "stopping", "stopped"],
  working: ["idle", "waiting_approval", "parked", "stopping", "stopped", "error"],
  waiting_approval: ["working", "parked", "stopping", "stopped", "error"],
  parked: ["working", "stopping", "stopped", "error"],
  stopping: ["stopped", "error"],
  stopped: [],
  error: ["stopping", "stopped"],
};

export class SessionManager {
  private readonly live = new Map<string, LiveSession>();

  private readonly db: HubDatabase;
  private readonly store: EventStore;
  private readonly registry: AdapterRegistry;
  private readonly runner: WorkerRunner;

  constructor(db: HubDatabase, store: EventStore, registry: AdapterRegistry, runner: WorkerRunner) {
    this.db = db;
    this.store = store;
    this.registry = registry;
    this.runner = runner;
  }

  /** Subscribe to event batches of a session (server WS push). */
  subscribe(sessionId: string, cb: (events: NormalizedEvent[]) => void): () => void {
    const s = this.live.get(sessionId);
    if (!s) return () => undefined;
    s.subscribers.add(cb);
    return () => s.subscribers.delete(cb);
  }

  list(): SessionRecord[] {
    return (
      this.db
        .prepare("SELECT * FROM sessions ORDER BY created_at DESC")
        .all() as unknown as SessionRow[]
    ).map(rowToRecord);
  }

  get(sessionId: string): SessionRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(sessionId) as unknown as SessionRow | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  require(sessionId: string): SessionRecord {
    const rec = this.get(sessionId);
    if (!rec) throw new Error(`unknown session ${sessionId}`);
    return rec;
  }

  async create(spec: unknown): Promise<SessionRecord> {
    const parsed = SessionSpecSchema.parse(spec);
    const registered = this.registry.require(parsed.adapter);
    const now = new Date().toISOString();
    const record: SessionRecord = {
      id: randomUUID(),
      adapter: parsed.adapter,
      project: parsed.project,
      worktreeSha: null,
      model: parsed.model ?? null,
      status: "starting",
      createdAt: now,
      budgetUsd: parsed.budgetUsd ?? null,
      adapterVersion: registered.adapter.version,
      lastSeq: 0,
    };
    await this.store.initSession(record.id);
    this.persist(record);

    const session: LiveSession = {
      record,
      adapter: registered.adapter,
      handle: null,
      abort: new AbortController(),
      subscribers: new Set(),
    };
    this.live.set(record.id, session);

    const ctx = this.makeContext(session);
    await this.emitSystem(session, "session.created", {
      adapter: record.adapter,
      adapterVersion: record.adapterVersion,
      project: record.project,
      model: record.model,
      budgetUsd: record.budgetUsd,
    });
    try {
      session.handle = await session.adapter.start(parsed, ctx);
      await this.setStatus(session, "working");
      await this.emitSystem(session, "session.started", {
        pid: session.handle.pid ?? null,
        capabilities: registered.capabilities,
      });
    } catch (err) {
      await this.setStatus(session, "error");
      await this.emitSystem(session, "session.start_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return { ...record };
  }

  async steer(sessionId: string, input: SteerInput): Promise<Ack> {
    const session = this.live.get(sessionId);
    if (!session || !session.handle) return { ok: false, detail: "session not live" };
    if (input.kind === "stop") return this.stop(sessionId);
    const ack = await session.adapter.steer(session.handle, input, this.makeContext(session));
    await this.emitSystem(session, "session.steer", { kind: input.kind, ok: ack.ok });
    return ack;
  }

  async stop(sessionId: string): Promise<Ack> {
    const session = this.live.get(sessionId);
    if (!session) return { ok: false, detail: "session not live" };
    await this.setStatus(session, "stopping");
    session.abort.abort();
    try {
      if (session.handle) await session.adapter.stop(session.handle, this.makeContext(session));
    } finally {
      await this.setStatus(session, "stopped");
      await this.emitSystem(session, "session.stopped", {});
    }
    return { ok: true };
  }

  async park(sessionId: string): Promise<Ack> {
    const session = this.live.get(sessionId);
    if (!session) return { ok: false, detail: "session not live" };
    await this.setStatus(session, "parked");
    await this.emitSystem(session, "session.parked", {});
    return { ok: true };
  }

  async tail(sessionId: string, afterSeq: number, limit?: number): Promise<NormalizedEvent[]> {
    return this.store.tail(sessionId, afterSeq, limit);
  }

  async readBlob(sessionId: string, hash: string): Promise<Buffer> {
    return this.store.readBlob(sessionId, hash);
  }

  /**
   * K7 crash recovery: restore every persisted session.
   * Identical status/event-count after `kill -9`, restore < 3 s.
   */
  async recoverAll(): Promise<{ recovered: number; failed: number; reaped: string[] }> {
    const t0 = performance.now();
    const persisted = this.list();
    const keepWorkers: string[] = [];
    let recovered = 0;
    let failed = 0;

    for (const record of persisted) {
      if (record.status === "stopped") {
        recovered++;
        continue;
      }
      const events = await this.store.replay(record.id);
      const lastSeq = events.length > 0 ? events[events.length - 1]!.seq : 0;
      const registered = this.registry.get(record.adapter);
      const session: LiveSession = {
        record: { ...record, lastSeq },
        adapter: registered?.adapter ?? null as unknown as Adapter,
        handle: null,
        abort: new AbortController(),
        subscribers: new Set(),
      };
      this.live.set(record.id, session);

      if (!registered) {
        await this.setStatus(session, "error");
        await this.emitSystem(session, "session.recovery_failed", {
          reason: `adapter "${record.adapter}" not registered`,
        });
        failed++;
        continue;
      }
      try {
        if (registered.adapter.recover) {
          const handle = await registered.adapter.recover(
            record.id,
            lastSeq,
            this.makeContext(session),
          );
          session.handle = handle;
          if (handle?.pid) keepWorkers.push(`${record.id}`);
        }
        await this.emitSystem(session, "session.recovered", {
          events: events.length,
          lastSeq,
        });
        recovered++;
      } catch (err) {
        await this.setStatus(session, "error");
        await this.emitSystem(session, "session.recovery_failed", {
          reason: err instanceof Error ? err.message : String(err),
        });
        failed++;
      }
    }

    const reaped = await this.runner.reapOrphans(keepWorkers).catch(() => []);
    const elapsed = performance.now() - t0;
    if (elapsed > 3000) {
      console.warn(`[session-manager] recovery took ${elapsed.toFixed(0)} ms (> 3000 ms budget, K7)`);
    }
    return { recovered, failed, reaped };
  }

  async shutdown(): Promise<void> {
    for (const [id, session] of this.live) {
      if (session.record.status === "stopped" || session.record.status === "stopping") continue;
      await this.stop(id).catch(() => undefined);
    }
    await this.store.flush();
  }

  private makeContext(session: LiveSession): AdapterContext {
    return {
      sessionId: session.record.id,
      signal: session.abort.signal,
      workdir: session.record.project,
      log: (level, msg, extra) => {
        const line = `[adapter:${session.record.adapter}] ${msg}`;
        if (level === "error") console.error(line, extra ?? "");
        else if (level === "warn") console.warn(line, extra ?? "");
        else console.log(line, extra ?? "");
      },
      emit: (event: EmittedEvent) => {
        void this.emitEvents(session, [event]).catch((err) => {
          // Late emission after shutdown/cleanup must never crash the daemon.
          session.record.status = "error";
          console.error(
            `[session:${session.record.id}] event append failed:`,
            err instanceof Error ? err.message : err,
          );
        });
      },
      blob: async (data: string | Uint8Array): Promise<BlobRef> => {
        return this.store.writeBlob(session.record.id, data);
      },
      spawnWorker: async (cmd, opts) => {
        return this.runner.spawn({
          name: session.record.id,
          cwd: session.record.project,
          cmd,
          ...(opts?.env !== undefined ? { env: opts.env } : {}),
          ...(opts?.cols !== undefined ? { cols: opts.cols } : {}),
          ...(opts?.rows !== undefined ? { rows: opts.rows } : {}),
        });
      },
    };
  }

  private async emitEvents(session: LiveSession, emitted: EmittedEvent[]): Promise<void> {
    const events: NormalizedEvent[] = emitted.map((e) => ({
      seq: ++session.record.lastSeq,
      ts: e.ts ?? new Date().toISOString(),
      sessionId: session.record.id,
      type: e.type,
      summary: e.summary.slice(0, 200),
      payload: e.payload ?? {},
      blobRef: e.blobRef ?? null,
      ...(e.tokensEst !== undefined ? { tokensEst: e.tokensEst } : {}),
    }));
    const enforced = await this.store.append(session.record.id, events);
    this.persist(session.record);
    for (const sub of session.subscribers) {
      try {
        sub(enforced);
      } catch {
        // a slow/broken subscriber never blocks the stream
      }
    }
  }

  private async emitSystem(session: LiveSession, kind: string, payload: Record<string, unknown>): Promise<void> {
    await this.emitEvents(session, [
      { type: "system", summary: kind, payload: { kind, ...payload } },
    ]);
    await this.store.saveSnapshot(session.record.id, this.snapshotOf(session));
  }

  private snapshotOf(session: LiveSession): SessionSnapshot {
    return {
      sessionId: session.record.id,
      status: session.record.status,
      lastSeq: session.record.lastSeq,
      adapterVersion: session.record.adapterVersion,
      savedAt: new Date().toISOString(),
    };
  }

  private async setStatus(session: LiveSession, status: SessionStatus): Promise<void> {
    const allowed = VALID_TRANSITIONS[session.record.status] ?? [];
    if (!allowed.includes(status) && session.record.status !== status) {
      throw new Error(
        `illegal session transition ${session.record.status} → ${status} (${session.record.id})`,
      );
    }
    session.record.status = status;
    this.persist(session.record);
    await this.store.saveSnapshot(session.record.id, this.snapshotOf(session));
  }

  private persist(record: SessionRecord): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, adapter, project, worktree_sha, model, status, created_at, budget_usd, adapter_version, last_seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           model = excluded.model,
           worktree_sha = excluded.worktree_sha,
           budget_usd = excluded.budget_usd,
           adapter_version = excluded.adapter_version,
           last_seq = excluded.last_seq`,
      )
      .run(
        record.id,
        record.adapter,
        record.project,
        record.worktreeSha,
        record.model,
        record.status,
        record.createdAt,
        record.budgetUsd,
        record.adapterVersion,
        record.lastSeq,
      );
  }
}

/** Hash a device token for storage (tokens are shown once at issuance). */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
