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
  UsageQuota,
} from "@uacc/contracts";
import { SessionSpec as SessionSpecSchema } from "@uacc/contracts";
import type { EventStore } from "./eventstore.ts";
import type { AdapterRegistry } from "./registry.ts";
import type { HubDatabase } from "./db.ts";
import type { WorktreeManager } from "./worktree.ts";

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
  /** T2.1: real per-session working directory — the worktree path when
   * isolation succeeded, else the raw `record.project` (honest fallback,
   * see WorktreeManager's doc comment). Adapters only ever see this via
   * AdapterContext.workdir/spawnWorker cwd, never `record.project`
   * directly, once a session is live. */
  workdir: string;
  /** Set only when this session actually got worktree isolation — needed
   * at stop() time to know whether (and against which real repo) to
   * `git worktree remove`. */
  worktreeIsolated: boolean;
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
  cost_usd: number;
  updated_at: string;
  tokens_est: number;
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
    costUsd: row.cost_usd,
    updatedAt: row.updated_at,
    tokensEst: row.tokens_est,
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

/** T1.9: 30s default per EPIC-P1 §2 ("Heartbeat pro Adapter (30 s)"). */
const DEFAULT_HEARTBEAT_MS = 30_000;

/** Account-level usage/quota snapshot (ADR-0004) — keyed by adapter id,
 * NOT session id: rate limits are shared across every session of that
 * adapter-account, unlike SessionRecord.costUsd. Deliberately in-memory
 * only, never K7-persisted — the next active session of that adapter
 * delivers a fresh value on its first turn, and a value from before a hub
 * restart could already be stale anyway. */
export interface AdapterUsageSnapshot {
  quota: UsageQuota;
  observedAt: string;
}

export class SessionManager {
  private readonly live = new Map<string, LiveSession>();
  private readonly usageByAdapter = new Map<string, AdapterUsageSnapshot>();

  private readonly db: HubDatabase;
  private readonly store: EventStore;
  private readonly registry: AdapterRegistry;
  private readonly runner: WorkerRunner;
  private readonly worktrees: WorktreeManager | undefined;
  private readonly heartbeatTimer: NodeJS.Timeout;
  private heartbeatRunning = false;

  constructor(
    db: HubDatabase,
    store: EventStore,
    registry: AdapterRegistry,
    runner: WorkerRunner,
    heartbeatIntervalMs: number = DEFAULT_HEARTBEAT_MS,
    /** T2.1: optional — omitting it (every pre-P2 call site, every test
     * using a non-git temp dir as `project`) keeps the exact pre-P2
     * behavior: sessions run directly in `record.project`, no isolation. */
    worktrees?: WorktreeManager,
  ) {
    this.db = db;
    this.store = store;
    this.registry = registry;
    this.runner = runner;
    this.worktrees = worktrees;
    // T1.9 (AC-P1-5): poll each live adapter's own status() on a timer,
    // not just react to its worker process exiting. A hard-killed process
    // already surfaces via WorkerProcess.onExit (see makeContext below),
    // but "down" per the adapter's own health check (hung, degraded,
    // unreachable) needs an active probe — that's what onExit can't see.
    this.heartbeatTimer = setInterval(() => void this.runHeartbeat(), heartbeatIntervalMs);
    this.heartbeatTimer.unref();
  }

  /** Exposed for tests — same logic the timer runs, without waiting out
   * the real interval. */
  async runHeartbeat(): Promise<void> {
    if (this.heartbeatRunning) return; // don't overlap a slow previous tick
    this.heartbeatRunning = true;
    try {
      for (const session of this.live.values()) {
        if (!session.handle) continue;
        const terminal = session.record.status === "stopped" || session.record.status === "error";
        if (terminal) continue;
        let report;
        try {
          report = await session.adapter.status(session.handle);
        } catch (err) {
          // The health check itself failing is exactly the kind of
          // "unbekannter Ausfall" AGENTS.md rule 6 wants surfaced, not
          // silently retried forever.
          report = { state: "broken" as const, detail: err instanceof Error ? err.message : String(err) };
        }
        if (report.state === "down" || report.state === "broken") {
          await this.setStatus(session, "error").catch(() => undefined);
          await this.emitSystem(session, "adapter.down", {
            state: report.state,
            detail: report.detail ?? null,
          });
        }
      }
    } finally {
      this.heartbeatRunning = false;
    }
  }

  /** Subscribe to event batches of a session (server WS push). */
  subscribe(sessionId: string, cb: (events: NormalizedEvent[]) => void): () => void {
    const s = this.live.get(sessionId);
    if (!s) return () => undefined;
    s.subscribers.add(cb);
    return () => s.subscribers.delete(cb);
  }

  /** ADR-0004: latest account-level usage/quota snapshot for an adapter,
   * or null when this adapter has never emitted one (never guessed, never
   * a stale 0 — "null" reads as "no observation yet", not "no usage"). */
  getAdapterUsage(adapterId: string): AdapterUsageSnapshot | null {
    return this.usageByAdapter.get(adapterId) ?? null;
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
      costUsd: 0,
      updatedAt: now,
      tokensEst: 0,
    };
    await this.store.initSession(record.id);
    this.persist(record);

    const session: LiveSession = {
      record,
      adapter: registered.adapter,
      handle: null,
      abort: new AbortController(),
      subscribers: new Set(),
      workdir: record.project,
      worktreeIsolated: false,
    };
    this.live.set(record.id, session);

    // T2.1: attempt real worktree isolation before anything else touches
    // the filesystem. A non-git `project` (dummy-adapter tests, or a
    // genuinely non-git project directory) is a real, honest fallback —
    // not an error — surfaced as its own system event rather than silently
    // running unisolated (AGENTS.md Regel 6).
    if (this.worktrees) {
      try {
        const created = await this.worktrees.create(record.id, record.project);
        if (created) {
          session.workdir = created.path;
          session.worktreeIsolated = true;
          record.worktreeSha = created.baseSha;
          this.persist(record);
        }
      } catch (err) {
        await this.emitSystem(session, "session.worktree_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (!session.worktreeIsolated) {
      await this.emitSystem(session, "session.no_worktree_isolation", {
        reason: this.worktrees ? "project is not a git repo" : "worktree isolation not configured",
      });
    }

    const ctx = this.makeContext(session);
    await this.emitSystem(session, "session.created", {
      adapter: record.adapter,
      adapterVersion: record.adapterVersion,
      project: record.project,
      workdir: session.workdir,
      model: record.model,
      budgetUsd: record.budgetUsd,
      // T1.5-10/AC-P1.5-12: whatever skill/agent was requested must stay
      // traceable in the tail — nobody should have to guess afterwards
      // what a session was actually started with.
      args: parsed.args ?? null,
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
      // T2.1: clean up the isolated worktree once the adapter is done with
      // it. Best-effort and non-fatal to the stop path — a worktree that
      // fails to remove (e.g. a still-open fd from a slow-to-exit worker)
      // is a disk-hygiene problem to surface, not a reason to leave the
      // session stuck in "stopping".
      if (session.worktreeIsolated && this.worktrees) {
        try {
          await this.worktrees.remove(session.record.id, session.record.project);
        } catch (err) {
          await this.emitSystem(session, "session.worktree_cleanup_failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
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
      // T2.1: a session that had real worktree isolation before the crash
      // gets the same deterministic path back — the worktree itself is
      // still on disk (only the hub process died), so this is a real
      // re-attach, not a re-creation.
      const workdir =
        record.worktreeSha !== null && this.worktrees ? this.worktrees.pathFor(record.id) : record.project;
      const session: LiveSession = {
        record: { ...record, lastSeq },
        adapter: registered?.adapter ?? null as unknown as Adapter,
        handle: null,
        abort: new AbortController(),
        subscribers: new Set(),
        workdir,
        worktreeIsolated: workdir !== record.project,
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
    clearInterval(this.heartbeatTimer);
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
      workdir: session.workdir,
      log: (level, msg, extra) => {
        const line = `[adapter:${session.record.adapter}] ${msg}`;
        if (level === "error") console.error(line, extra ?? "");
        else if (level === "warn") console.warn(line, extra ?? "");
        else console.log(line, extra ?? "");
      },
      emit: (event: EmittedEvent) => {
        void this.emitEvents(session, [event]).catch((err) => this.handleEmitFailure(session, event, err));
      },
      blob: async (data: string | Uint8Array): Promise<BlobRef> => {
        return this.store.writeBlob(session.record.id, data);
      },
      spawnWorker: async (cmd, opts) => {
        return this.runner.spawn({
          name: session.record.id,
          cwd: session.workdir,
          cmd,
          ...(opts?.env !== undefined ? { env: opts.env } : {}),
          ...(opts?.cols !== undefined ? { cols: opts.cols } : {}),
          ...(opts?.rows !== undefined ? { rows: opts.rows } : {}),
        });
      },
    };
  }

  /**
   * AI-P0-5 / BUG-0003 follow-up: a failed store.append() used to be a bare
   * console.error plus a raw `session.record.status = "error"` mutation —
   * never persisted, never visible in the event stream, and the seq that
   * emitEvents() had already assigned was gone for good either way. That's
   * exactly the silent drop AGENTS.md rule 6 ("Fail loud") exists to rule
   * out. This makes the failure visible on both channels a subscriber or
   * API client can actually observe:
   *   - status: a real setStatus() call (validated transition, persisted
   *     to SQLite, snapshot saved) instead of an in-memory-only mutation.
   *   - stream: a best-effort follow-up "error" event. Most append
   *     failures are one-off (e.g. a transient EventStore race), so a
   *     second attempt usually lands; if it doesn't, that failure is
   *     logged too and swallowed rather than looping.
   */
  private async handleEmitFailure(session: LiveSession, failedEvent: EmittedEvent, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[session:${session.record.id}] event append failed:`, message);

    try {
      await this.setStatus(session, "error");
    } catch (statusErr) {
      // Late emission after shutdown/cleanup (session already "stopped",
      // no transition to "error" allowed) must never crash the daemon.
      console.error(`[session:${session.record.id}] could not persist error status:`, statusErr);
    }

    try {
      await this.emitEvents(session, [
        {
          type: "error",
          summary: `event append failed: ${message.slice(0, 150)}`,
          payload: { originalType: failedEvent.type, reason: message },
        },
      ]);
    } catch (retryErr) {
      console.error(`[session:${session.record.id}] could not surface append failure as an event either:`, retryErr);
    }
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
      ...(e.costUsd !== undefined ? { costUsd: e.costUsd } : {}),
      ...(e.usageQuota !== undefined ? { usageQuota: e.usageQuota } : {}),
    }));
    // ADR-0003: costUsd is per-event, not cumulative — the hub sums it.
    for (const e of events) {
      if (e.costUsd !== undefined) session.record.costUsd += e.costUsd;
      // ADR-0006: same per-event/summed pattern as costUsd, applied to the
      // tokensEst field that already existed on the event contract but was
      // never aggregated onto the session record.
      if (e.tokensEst !== undefined) session.record.tokensEst += e.tokensEst;
      // ADR-0004: usageQuota is account-level, NEVER summed and NEVER
      // written onto SessionRecord — only the latest snapshot per adapter
      // id, overwriting regardless of which session observed it (it's the
      // same account state either way).
      if (e.usageQuota !== undefined) {
        this.usageByAdapter.set(session.record.adapter, {
          quota: e.usageQuota,
          observedAt: new Date().toISOString(),
        });
      }
    }
    session.record.updatedAt = new Date().toISOString();
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
    session.record.updatedAt = new Date().toISOString();
    this.persist(session.record);
    await this.store.saveSnapshot(session.record.id, this.snapshotOf(session));
  }

  private persist(record: SessionRecord): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, adapter, project, worktree_sha, model, status, created_at, budget_usd, adapter_version, last_seq, cost_usd, updated_at, tokens_est)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           model = excluded.model,
           worktree_sha = excluded.worktree_sha,
           budget_usd = excluded.budget_usd,
           adapter_version = excluded.adapter_version,
           last_seq = excluded.last_seq,
           cost_usd = excluded.cost_usd,
           updated_at = excluded.updated_at,
           tokens_est = excluded.tokens_est`,
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
        record.costUsd,
        record.updatedAt,
        record.tokensEst,
      );
  }
}

/** Hash a device token for storage (tokens are shown once at issuance). */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
