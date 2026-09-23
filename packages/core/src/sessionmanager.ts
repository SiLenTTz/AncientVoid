import { randomUUID, createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  Adapter,
  AdapterContext,
  BlobRef,
  EmittedEvent,
  HubLogger,
  HubMetrics,
  NormalizedEvent,
  SessionHandle,
  SessionRecord,
  SessionSnapshot,
  SessionStatus,
  SteerInput,
  Ack,
  WorkerRunner,
  UsageQuota,
  ReportingSink,
  DiscoverySource,
  DiscoveredSession,
} from "@uacc/contracts";
import { DEFAULT_HOST_ID, RESUME_SCHEMA_VERSION, SessionSpec as SessionSpecSchema, unsupportedResume } from "@uacc/contracts";
import type { EventStore } from "./eventstore.ts";
import type { AdapterRegistry } from "./registry.ts";
import type { HubDatabase } from "./db.ts";
import type { WorktreeManager } from "./worktree.ts";
import type { ApprovalService } from "./approvals.ts";
import { buildSessionSummary } from "./digest.ts";
import { createConsoleLogger } from "./logger.ts";
import { dedupeDiscovered, pageDiscovered } from "./discovery.ts";
import { resolveSkillChain, withSkillChain } from "./skills.ts";

const WRITER_LEASE_MS = 30_000;

export interface SteerMeta {
  inputId?: string;
  revision?: number;
  clientId?: string;
}

export interface SessionManagerObservability {
  logger?: HubLogger;
  metrics?: HubMetrics;
}

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
  /** T2.7: true once the 80%-budget warning has fired for this session —
   * prevents every subsequent cost-bearing event from re-emitting it. */
  budgetWarned: boolean;
  /** Selected skill, so a later steer reloads the same extends chain. */
  skillName?: string;
}

function readSkillName(args: Record<string, unknown> | undefined): string | undefined {
  const skill = args?.skill;
  return typeof skill === "string" && skill.length > 0 ? skill : undefined;
}

function skillNameFromEvents(events: readonly NormalizedEvent[]): string | undefined {
  for (const event of events) {
    const payload = event.payload as { kind?: unknown; args?: unknown };
    if (payload.kind !== "session.created" || !payload.args || typeof payload.args !== "object") continue;
    return readSkillName(payload.args as Record<string, unknown>);
  }
  return undefined;
}

function nativeIdFromEvents(events: readonly NormalizedEvent[]): string | undefined {
  let found: string | undefined;
  for (const event of events) {
    const native = (event.payload as { nativeSessionId?: unknown }).nativeSessionId;
    if (typeof native === "string" && native.length > 0) found = native;
  }
  return found;
}

async function nativeIdFromWorkerLog(dataDir: string, sessionId: string): Promise<string | undefined> {
  try {
    const text = await readFile(join(dataDir, "workers", `uacc-${sessionId}.log`), "utf8");
    const ids = [...text.matchAll(/"session(?:ID|_id)"\s*:\s*"([^"]+)"/g)];
    return ids.at(-1)?.[1];
  } catch {
    return undefined;
  }
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
  park_reason: string | null;
  control_mode: string;
  harness: string;
  host_id: string;
  native_session_id: string | null;
  resume_version: number;
  log_offset: number | null;
  parent_session_id: string | null;
  observed_at: string | null;
  fork: number;
  input_revision: number;
  writer_client: string | null;
  writer_lease_until: string | null;
  archived: number;
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
    parkReason: row.park_reason as SessionRecord["parkReason"],
    controlMode: row.control_mode as SessionRecord["controlMode"],
    harness: row.harness as SessionRecord["harness"],
    hostId: row.host_id,
    nativeSessionId: row.native_session_id,
    resumeVersion: row.resume_version,
    logOffset: row.log_offset,
    parentSessionId: row.parent_session_id,
    observedAt: row.observed_at,
    fork: row.fork === 1,
    inputRevision: row.input_revision,
    writerClient: row.writer_client,
    writerLeaseUntil: row.writer_lease_until,
    archived: row.archived === 1,
  };
}

const VALID_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  idle: ["working", "waiting_approval", "parked", "stopping", "stopped", "error"],
  starting: ["working", "idle", "waiting_approval", "error", "stopping", "stopped"],
  working: ["idle", "waiting_approval", "parked", "stopping", "stopped", "error"],
  waiting_approval: ["working", "parked", "stopping", "stopped", "error"],
  parked: ["working", "stopping", "stopped", "error"],
  stopping: ["stopped", "error"],
  stopped: ["working"],
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
  /** T2.4: steer inputs parked behind a pending write-class approval,
   * keyed by ApprovalRequest.id — applied for real only once the decide
   * route reports a genuine "approved" (see applyApprovedSteer). Not
   * K7-persisted: a hub crash while an approval is still pending loses
   * the queued prompt along with it, same as any other in-flight,
   * not-yet-applied user action would be — the ApprovalRequest itself
   * (in SQLite) still shows what was asked for, it just can no longer be
   * carried out after a restart. Documented here, not silently assumed. */
  private readonly pendingSteers = new Map<string, { sessionId: string; input: SteerInput }>();
  /** Tail of the per-session steer chain (see steer()). */
  private readonly steerQueue = new Map<string, Promise<void>>();

  private readonly db: HubDatabase;
  private readonly store: EventStore;
  private readonly registry: AdapterRegistry;
  private readonly runner: WorkerRunner;
  private readonly worktrees: WorktreeManager | undefined;
  private readonly approvals: ApprovalService | undefined;
  private readonly dailyCapUsd: number | null;
  private readonly reportingSinks: ReportingSink[];
  private readonly logger: HubLogger;
  private readonly metrics: HubMetrics | undefined;
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
    /** T2.4: optional — omitting it keeps steer()'s exact pre-P2 behavior
     * (forwarded to the adapter immediately, no approval gate). Every
     * existing call site predates this and stays unaffected. */
    approvals?: ApprovalService,
    /** T2.7: hub-wide daily cost cap (EPIC-P2 §3) — omitted/null means no
     * cap, the exact pre-T2.7 behavior. */
    dailyCapUsd: number | null = null,
    /** T4.1/ADR-0009: fire-and-forget digest consumers, called once per
     * completed session. Empty array (default) is the exact pre-T4.1
     * behavior — no digests, no new network egress unless explicitly
     * configured (same "default off" principle as the MCP gateway, OD-2). */
    reportingSinks: ReportingSink[] = [],
    observability: SessionManagerObservability = {},
  ) {
    this.db = db;
    this.store = store;
    this.registry = registry;
    this.runner = runner;
    this.worktrees = worktrees;
    this.approvals = approvals;
    this.dailyCapUsd = dailyCapUsd;
    this.reportingSinks = reportingSinks;
    this.logger = observability.logger ?? createConsoleLogger();
    this.metrics = observability.metrics;
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

  sessionCounts(): { live: number; total: number; byStatus: Record<string, number> } {
    const records = this.list();
    const byStatus: Record<string, number> = {};
    for (const record of records) {
      byStatus[record.status] = (byStatus[record.status] ?? 0) + 1;
    }
    return { live: this.live.size, total: records.length, byStatus };
  }

  /**
   * Hub rows plus external sources, deduped, paged. Unknown resume versions
   * stay in the list with unsupportedResume (K9), they are not dropped.
   */
  async discover(
    sources: readonly DiscoverySource[] = [],
    cursor = 0,
    limit = 50,
  ): Promise<{ items: DiscoveredSession[]; nextCursor: number | null }> {
    const external: DiscoveredSession[] = [];
    for (const source of sources) external.push(...(await source.list()));
    const merged = dedupeDiscovered([...this.list().map((record) => this.toDiscovered(record)), ...external]);
    return pageDiscovered(merged, cursor, limit);
  }

  async hasLiveWorker(sessionId: string): Promise<boolean> {
    const workers = await this.runner.list();
    return workers.some((worker) => worker.name === sessionId);
  }

  get(sessionId: string): SessionRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(sessionId) as unknown as SessionRow | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  /** T2.2: the real, live working directory for a session — the worktree
   * path when T2.1 isolation succeeded, else `record.project`. Used by the
   * diff engine so it diffs where the session's changes actually are,
   * not always the raw project path. Undefined only for a session id the
   * manager has never seen (never created, never recovered). */
  workdirOf(sessionId: string): string | undefined {
    return this.live.get(sessionId)?.workdir;
  }

  require(sessionId: string): SessionRecord {
    const rec = this.get(sessionId);
    if (!rec) throw new Error(`unknown session ${sessionId}`);
    return rec;
  }

  /** Hide or restore a session in the overview. Does not stop the worker. */
  setArchived(sessionId: string, archived: boolean): SessionRecord {
    const live = this.live.get(sessionId);
    const record = live?.record ?? this.require(sessionId);
    record.archived = archived;
    record.updatedAt = new Date().toISOString();
    this.persist(record);
    return record;
  }

  /**
   * T2.8 (EPIC-P2 §2 "Audit-Trail: jede Handy-Aktion als Event im
   * Session-JSONL (wer-wann-was)"): `actor` is the calling device's own
   * token label (identify()d by the route, never the raw token) —
   * threaded through into the relevant system events below so a
   * session's own tail answers "wer" without cross-referencing the
   * approvals table or server logs. `undefined` (every pre-T2.8 call
   * site, every test) renders as `actor: null` — "no caller identity
   * available", not "system" or a guess.
   */
  async create(spec: unknown, actor?: string): Promise<SessionRecord> {
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
      parkReason: null,
      controlMode: "managed",
      harness: "cli",
      hostId: DEFAULT_HOST_ID,
      nativeSessionId: null,
      resumeVersion: RESUME_SCHEMA_VERSION,
      logOffset: null,
      parentSessionId: null,
      observedAt: null,
      fork: false,
      inputRevision: 0,
      writerClient: null,
      writerLeaseUntil: null,
      archived: false,
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
      budgetWarned: false,
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
    const skillName = readSkillName(parsed.args);
    let startSpec = parsed;
    if (skillName) {
      session.skillName = skillName;
      const chain = await resolveSkillChain(parsed.project, skillName);
      if (chain) {
        startSpec = {
          ...parsed,
          ...(parsed.prompt !== undefined ? { prompt: withSkillChain(parsed.prompt, chain.block) } : {}),
          args: { ...parsed.args, skillChain: chain.names },
        };
        await this.emitEvents(session, [
          {
            type: "system",
            summary: `Skills ${chain.names.join(" → ")}`,
            payload: { kind: "session.skill_chain", names: chain.names },
          },
        ]);
      }
    }
    await this.emitSystem(session, "session.created", {
      adapter: record.adapter,
      adapterVersion: record.adapterVersion,
      project: record.project,
      workdir: session.workdir,
      model: record.model,
      budgetUsd: record.budgetUsd,
      // T1.5-10/AC-P1.5-12: whatever skill/agent was requested must stay
      // traceable in the tail — nobody should have to guess afterwards
      // what a session was actually started with. skillChain is names
      // only; the skill bodies ride in the prompt, not this event.
      args: startSpec.args ?? null,
      actor: actor ?? null,
    });
    try {
      session.handle = await session.adapter.start(startSpec, ctx);
      await this.setStatus(session, "working");
      await this.emitSystem(session, "session.started", {
        pid: session.handle.pid ?? null,
        capabilities: registered.capabilities,
      });
      this.metrics?.inc("sessions_started");
      this.logger.info("session started", {
        sessionId: record.id,
        adapter: record.adapter,
      });
    } catch (err) {
      await this.setStatus(session, "error");
      await this.emitSystem(session, "session.start_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return { ...record };
  }

  private stoppedShell(record: SessionRecord, events: readonly NormalizedEvent[]): LiveSession {
    const registered = this.registry.get(record.adapter);
    const isolated =
      record.worktreeSha !== null && this.worktrees !== undefined && existsSync(this.worktrees.pathFor(record.id));
    const workdir = isolated && this.worktrees ? this.worktrees.pathFor(record.id) : record.project;
    const skill = skillNameFromEvents(events);
    const native = record.nativeSessionId ?? nativeIdFromEvents(events);
    if (native) record.nativeSessionId = native;
    return {
      record,
      adapter: registered?.adapter ?? (null as unknown as Adapter),
      handle: null,
      abort: new AbortController(),
      subscribers: new Set(),
      workdir,
      worktreeIsolated: isolated,
      ...(skill ? { skillName: skill } : {}),
      budgetWarned: record.budgetUsd !== null && record.costUsd >= record.budgetUsd * 0.8,
    };
  }

  private async promptWithSkill(session: LiveSession, text: string): Promise<string> {
    if (!session.skillName) return text;
    const chain = await resolveSkillChain(session.record.project, session.skillName);
    if (!chain) {
      await this.emitSystem(session, "session.skill_chain_missing", { skill: session.skillName });
      return text;
    }
    return withSkillChain(text, chain.block);
  }

  /** A stopped run keeps its provider session id. A new prompt spawns the CLI again. */
  private async continueStopped(
    session: LiveSession,
    input: Extract<SteerInput, { kind: "prompt" }>,
    actor?: string,
  ): Promise<Ack> {
    session.abort = new AbortController();
    if (!session.skillName || !session.record.nativeSessionId) {
      const events = await this.store.replay(session.record.id);
      if (!session.skillName) {
        const skill = skillNameFromEvents(events);
        if (skill) session.skillName = skill;
      }
      if (!session.record.nativeSessionId) {
        const native = nativeIdFromEvents(events) ?? (await nativeIdFromWorkerLog(this.store.directory(), session.record.id));
        if (native) session.record.nativeSessionId = native;
      }
    }
    if (this.worktrees && !existsSync(session.workdir)) {
      try {
        const created = await this.worktrees.create(session.record.id, session.record.project);
        if (created) {
          session.workdir = created.path;
          session.worktreeIsolated = true;
          session.record.worktreeSha = created.baseSha;
        } else {
          session.workdir = session.record.project;
          session.worktreeIsolated = false;
        }
      } catch (err) {
        session.workdir = session.record.project;
        session.worktreeIsolated = false;
        await this.emitSystem(session, "session.worktree_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const text = await this.promptWithSkill(session, input.text);
    await this.setStatus(session, "working");
    const native = session.record.nativeSessionId;
    if (!native) {
      await this.emitSystem(session, "session.resume_without_native_id", {
        detail: "Provider-Session unbekannt, der Prompt startet einen neuen Lauf",
      });
    }
    try {
      session.handle = await session.adapter.start(
        {
          adapter: session.record.adapter,
          project: session.record.project,
          prompt: text,
          ...(session.record.model ? { model: session.record.model } : {}),
          args: {
            ...(session.skillName ? { skill: session.skillName } : {}),
            ...(native ? { resumeSessionId: native } : {}),
          },
        },
        this.makeContext(session),
      );
      await this.emitSystem(session, "session.continued", { actor: actor ?? null, nativeSessionId: native });
      return { ok: true };
    } catch (err) {
      await this.setStatus(session, "error");
      await this.emitSystem(session, "session.start_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Steers of one session run one after another. Input-id, revision and
   * lease checks only hold if no second steer passes them while the first
   * is still awaiting (BUG-0017: two clients reopened a stopped run twice). */
  steer(sessionId: string, input: SteerInput, actor?: string, meta?: SteerMeta): Promise<Ack> {
    const previous = this.steerQueue.get(sessionId) ?? Promise.resolve();
    const run = previous.then(() => this.steerNow(sessionId, input, actor, meta));
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    this.steerQueue.set(sessionId, settled);
    void settled.then(() => {
      if (this.steerQueue.get(sessionId) === settled) this.steerQueue.delete(sessionId);
    });
    return run;
  }

  private async steerNow(sessionId: string, input: SteerInput, actor?: string, meta?: SteerMeta): Promise<Ack> {
    let session = this.live.get(sessionId);
    if (!session) {
      const record = this.get(sessionId);
      if (!record || record.status !== "stopped") return { ok: false, detail: "session not live" };
      session = this.stoppedShell(record, await this.store.replay(sessionId));
      this.live.set(sessionId, session);
    }
    if (!session.handle && input.kind !== "prompt") return { ok: false, detail: "session not live" };
    if (meta?.inputId && this.hasSeenInput(sessionId, meta.inputId)) {
      return { ok: true, detail: "duplicate input ignored" };
    }
    if (meta?.revision !== undefined && meta.revision !== session.record.inputRevision) {
      return { ok: false, detail: "revision conflict" };
    }
    const leaseUntil = session.record.writerLeaseUntil ? Date.parse(session.record.writerLeaseUntil) : 0;
    if (
      meta?.clientId &&
      session.record.writerClient &&
      session.record.writerClient !== meta.clientId &&
      leaseUntil > Date.now()
    ) {
      return { ok: false, detail: "writer lease held" };
    }
    if (input.kind === "stop") {
      if (session.record.status === "stopped") return { ok: true };
      return this.stop(sessionId, actor);
    }
    let delivered = input;
    const reopening = input.kind === "prompt" && (session.record.status === "stopped" || !session.handle);
    if (input.kind === "prompt" && session.skillName && !reopening) {
      delivered = { ...input, text: await this.promptWithSkill(session, input.text) };
    }
    // T2.4/ADR-0007: "Steer-Prompt" is explicitly a write-class action
    // (EPIC-P2 §3 table) once an ApprovalService is configured — parked,
    // not forwarded, until a real approval decision comes back through
    // applyApprovedSteer(). `stop`/`park`/`resume` stay ungated: EPIC-P2's
    // class table lists commit/session-start/steer-prompt as the
    // write-class examples, not "make the agent stop".
    if (this.approvals && input.kind === "prompt") {
      const req = this.approvals.create(
        sessionId,
        "write",
        "steer.prompt",
        `Prompt an ${session.record.adapter} senden: "${input.text.slice(0, 160)}"`,
      );
      this.pendingSteers.set(req.id, { sessionId, input: delivered });
      await this.emitSystem(session, "session.steer_pending_approval", { approvalId: req.id, actor: actor ?? null });
      return { ok: false, detail: `pending approval ${req.id}` };
    }
    if (reopening && delivered.kind === "prompt") {
      // BUG-0016: the reopen is a steer like any other — without the
      // commit, a retried input id started the provider a second time.
      const reopened = await this.continueStopped(session, delivered, actor);
      if (reopened.ok) this.commitSteerMeta(session, meta);
      return reopened;
    }
    const ack = await session.adapter.steer(session.handle!, delivered, this.makeContext(session));
    // BUG found via T2.8's own audit test: emitSystem() builds
    // `{ kind, ...payload }`, where `kind` is this call's own event-kind
    // string ("session.steer") — a payload field ALSO named `kind` (the
    // steer input's kind, e.g. "resume") silently overwrote it, so every
    // non-"prompt" steer's audit event had payload.kind === "resume"/
    // "park" instead of "session.steer" ever since T2.4 introduced this
    // call. Named `steerKind` here to never collide again.
    await this.emitSystem(session, "session.steer", { steerKind: input.kind, ok: ack.ok, actor: actor ?? null });
    if (ack.ok) this.commitSteerMeta(session, meta);
    return ack;
  }

  /**
   * T2.4: the one place a write-class steer actually reaches the adapter
   * once approved — called by the /api/approvals/:id/decide route right
   * after ApprovalService.decide() reports a genuine "approved" (never
   * called speculatively, never called for a rejection). A missing entry
   * (unknown approvalId, or the session ended while the approval sat
   * pending) is a real, nameable outcome, not a crash.
   */
  async applyApprovedSteer(approvalId: string, decidedByLabel?: string): Promise<Ack> {
    const pending = this.pendingSteers.get(approvalId);
    if (!pending) return { ok: false, detail: "no pending steer for this approval" };
    this.pendingSteers.delete(approvalId);
    const session = this.live.get(pending.sessionId);
    if (!session) return { ok: false, detail: "session not live" };
    if (pending.input.kind === "prompt" && (session.record.status === "stopped" || !session.handle)) {
      return this.continueStopped(session, pending.input, decidedByLabel);
    }
    if (!session.handle) return { ok: false, detail: "session not live" };
    const ack = await session.adapter.steer(session.handle, pending.input, this.makeContext(session));
    await this.emitSystem(session, "session.steer", {
      steerKind: pending.input.kind,
      ok: ack.ok,
      approvalId,
      actor: decidedByLabel ?? null,
    });
    return ack;
  }

  /** T2.7: pending budget top-ups, same "not applied until a real
   * approval comes back" pattern as pendingSteers. */
  private readonly pendingBudgetTopUps = new Map<string, { sessionId: string; newBudgetUsd: number }>();

  /**
   * Requests a budget change for a session — EPIC-P2 §3 lists "Budget-
   * Änderung" as a write-class action requiring a reason. Applied
   * immediately only when no ApprovalService is configured (same opt-in
   * pattern as steer()); otherwise parked as a pending approval and only
   * actually applied by applyApprovedBudgetTopUp() once approved.
   */
  async requestBudgetTopUp(
    sessionId: string,
    newBudgetUsd: number,
    reason?: string,
    actor?: string,
  ): Promise<Ack & { approvalId?: string }> {
    const session = this.live.get(sessionId);
    if (!session) return { ok: false, detail: "session not live" };
    if (!this.approvals) {
      await this.applyBudgetTopUp(sessionId, newBudgetUsd, actor);
      return { ok: true };
    }
    const req = this.approvals.create(
      sessionId,
      "write",
      "budget.increase",
      `Budget auf ${newBudgetUsd.toFixed(2)}$ erhöhen${reason ? ` (${reason})` : ""}`,
      true, // ADR-0007: a budget change always requires a reason, unlike a plain steer prompt
    );
    this.pendingBudgetTopUps.set(req.id, { sessionId, newBudgetUsd });
    await this.emitSystem(session, "session.budget_topup_pending_approval", {
      approvalId: req.id,
      newBudgetUsd,
      actor: actor ?? null,
    });
    return { ok: false, detail: `pending approval ${req.id}`, approvalId: req.id };
  }

  /**
   * T2.8 (EPIC-P2 §2 "Audit-Trail … inkl. verweigerter Aktionen"): unlike
   * applyApprovedSteer/applyApprovedBudgetTopUp (which only ever run on a
   * genuine approval), this records EVERY decision — approved or
   * rejected, write or destructive — onto the session's own tail. Without
   * this, a rejected request only ever showed up in the separate
   * approvals table; a reviewer reading one session's history alone
   * couldn't see that an action was even requested and denied.
   */
  async recordApprovalDecision(
    sessionId: string,
    approvalId: string,
    action: string,
    status: "approved" | "rejected",
    decidedByLabel: string,
  ): Promise<void> {
    const session = this.live.get(sessionId);
    if (!session) return; // session ended while the approval sat pending — nothing to record onto
    await this.emitSystem(session, "session.approval_decided", { approvalId, action, status, actor: decidedByLabel });
  }

  /** Called by the decide route once a `budget.increase` approval is
   * genuinely approved — mirrors applyApprovedSteer. */
  async applyApprovedBudgetTopUp(approvalId: string, decidedByLabel?: string): Promise<Ack> {
    const pending = this.pendingBudgetTopUps.get(approvalId);
    if (!pending) return { ok: false, detail: "no pending budget top-up for this approval" };
    this.pendingBudgetTopUps.delete(approvalId);
    return this.applyBudgetTopUp(pending.sessionId, pending.newBudgetUsd, decidedByLabel);
  }

  async stop(sessionId: string, actor?: string): Promise<Ack> {
    const session = this.live.get(sessionId);
    if (!session) return { ok: false, detail: "session not live" };
    session.record.parkReason = null; // ADR-0008: leaving "parked" (if it was) for good, never a stale reason
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
      await this.emitSystem(session, "session.stopped", { actor: actor ?? null });
      this.metrics?.inc("sessions_stopped");
      this.logger.info("session stopped", { sessionId, adapter: session.record.adapter });
      this.dispatchDigest(session);
    }
    return { ok: true };
  }

  /** ADR-0009: fire-and-forget, best-effort. A throwing/rejecting sink
   * must never affect the (already-returned) stop() result — errors are
   * caught per-sink and surfaced as a real system event instead of a
   * silent drop (AGENTS.md Regel 6 "fail loud"). */
  private dispatchDigest(session: LiveSession): void {
    if (this.reportingSinks.length === 0) return;
    void (async () => {
      await this.store.flush(session.record.id);
      const events = await this.store.replay(session.record.id);
      const summary = buildSessionSummary(session.record, events);
      for (const sink of this.reportingSinks) {
        try {
          await sink(summary);
        } catch (err) {
          await this.emitSystem(session, "session.digest_sink_failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();
  }

  async park(sessionId: string, actor?: string): Promise<Ack> {
    const session = this.live.get(sessionId);
    if (!session) return { ok: false, detail: "session not live" };
    await this.parkFor(session, "manual", actor);
    return { ok: true };
  }

  /** T2.7/ADR-0008: the one place any kind of park actually happens —
   * records WHY, so a later budget top-up knows whether it's the right
   * reason to auto-resume (see applyBudgetTopUp). */
  private async parkFor(session: LiveSession, reason: SessionRecord["parkReason"], actor?: string): Promise<void> {
    // Real bug found live-testing T2.7: this used to only flip the hub's
    // OWN status label — an adapter with any free-running work (a real
    // CLI process still streaming, a generator loop like adapter-dummy's)
    // kept right on going and kept right on costing money, since nothing
    // ever told it to stop. "Fail-closed" requires actually reaching the
    // adapter, not just relabeling it: SteerInput{kind:"park"} is the
    // real, existing adapter-level pause mechanism (adapter-dummy already
    // implements it) — every park (manual, budget, daily-cap) now uses it
    // before the hub status changes underneath it.
    if (session.handle) {
      try {
        await session.adapter.steer(session.handle, { kind: "park" }, this.makeContext(session));
      } catch (err) {
        await this.emitSystem(session, "session.park_signal_failed", {
          reason,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    session.record.parkReason = reason;
    await this.setStatus(session, "parked");
    await this.emitSystem(session, "session.parked", { reason, actor: actor ?? null });
  }

  /**
   * T2.7 (EPIC-P2 §3 BudgetState): checked after every cost-bearing
   * event. 80% -> a visible warning event (this hub has no real push
   * infrastructure yet — "Push-Warnung" in the design doc is honestly
   * represented here as a system event the PWA can surface, not an
   * actual mobile push). 100% -> hard park, fail-closed (no further
   * provider calls happen because the adapter is genuinely stopped, not
   * merely marked). Warns at most once per session (`budgetWarned`)
   * so every subsequent cost-bearing event doesn't re-spam it.
   */
  private async checkBudget(session: LiveSession): Promise<void> {
    const budget = session.record.budgetUsd;
    if (budget === null) return;
    const terminal = session.record.status === "stopped" || session.record.status === "parked" || session.record.status === "error";
    if (terminal) return;
    if (session.record.costUsd >= budget) {
      await this.emitSystem(session, "session.budget_exceeded", { costUsd: session.record.costUsd, budgetUsd: budget });
      await this.parkFor(session, "budget");
      return;
    }
    if (!session.budgetWarned && session.record.costUsd >= budget * 0.8) {
      session.budgetWarned = true;
      await this.emitSystem(session, "session.budget_warning", {
        costUsd: session.record.costUsd,
        budgetUsd: budget,
        detail: "80% des Budgets verbraucht (kein echter Mobile-Push — dieser Hub hat keine Push-Infrastruktur, siehe EPIC-P2 T2.7)",
      });
    }
  }

  /**
   * T2.7 top-up flow: only actually resumes a session that was parked
   * FOR BUDGET (ADR-0008) — a manually parked or daily-cap-parked session
   * is untouched by raising this one session's own budget. Returns a
   * named failure rather than silently no-op'ing so a caller (the
   * approval-decide route) can surface why nothing happened.
   */
  async applyBudgetTopUp(sessionId: string, newBudgetUsd: number, actor?: string): Promise<Ack> {
    const session = this.live.get(sessionId);
    if (!session) return { ok: false, detail: "session not live" };
    session.record.budgetUsd = newBudgetUsd;
    session.budgetWarned = false;
    this.persist(session.record);
    await this.emitSystem(session, "session.budget_topup", { newBudgetUsd, actor: actor ?? null });
    if (session.record.status === "parked" && session.record.parkReason === "budget") {
      session.record.parkReason = null;
      await this.setStatus(session, "working");
      // Mirrors parkFor()'s real adapter signal — a top-up that only
      // flips the hub's own status back to "working" while the adapter
      // itself is still internally paused (e.g. adapter-dummy's own
      // steer(park) sets its generator loop's running flag false) would
      // show a session that looks resumed but never actually continues.
      if (session.handle) {
        try {
          await session.adapter.steer(session.handle, { kind: "resume" }, this.makeContext(session));
        } catch (err) {
          await this.emitSystem(session, "session.resume_signal_failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      await this.emitSystem(session, "session.resumed_after_topup", { actor: actor ?? null });
    }
    return { ok: true };
  }

  /**
   * T2.7 (EPIC-P2 §3 "Tages-Cap pro Rechner"): a hub-wide cap across every
   * session created since 00:00 UTC today, independent of any single
   * session's own budgetUsd — protection against a runaway/looping agent
   * that a per-session cap wouldn't catch if it never had one set. Parks
   * EVERY live, non-terminal session (there is no single "the" session to
   * blame for a hub-wide cap) rather than silently continuing.
   */
  private async checkDailyCap(): Promise<void> {
    if (this.dailyCapUsd === null) return;
    const today = new Date().toISOString().slice(0, 10);
    const spentToday = this.list()
      .filter((r) => r.createdAt.slice(0, 10) === today)
      .reduce((sum, r) => sum + r.costUsd, 0);
    if (spentToday < this.dailyCapUsd) return;
    for (const session of this.live.values()) {
      const terminal = session.record.status === "stopped" || session.record.status === "parked" || session.record.status === "error";
      if (terminal) continue;
      await this.emitSystem(session, "session.daily_cap_exceeded", { spentToday, dailyCapUsd: this.dailyCapUsd });
      await this.parkFor(session, "daily_cap");
    }
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
  async recoverAll(): Promise<{ recovered: number; failed: number; reaped: string[]; uncontrolled: number }> {
    const t0 = performance.now();
    const persisted = this.list();
    const keepWorkers: string[] = [];
    let recovered = 0;
    let failed = 0;
    let uncontrolled = 0;

    for (const record of persisted) {
      if (record.status === "stopped") {
        const events = await this.store.replay(record.id);
        const session = this.stoppedShell(record, events);
        this.live.set(record.id, session);
        if (session.record.nativeSessionId) this.persist(session.record);
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
      const recoveredSkill = skillNameFromEvents(events);
      const session: LiveSession = {
        record: { ...record, lastSeq },
        adapter: registered?.adapter ?? null as unknown as Adapter,
        handle: null,
        abort: new AbortController(),
        subscribers: new Set(),
        workdir,
        worktreeIsolated: workdir !== record.project,
        ...(recoveredSkill ? { skillName: recoveredSkill } : {}),
        // Not itself persisted (no JSONL/system-event replay here) — but
        // honestly recomputable from the record's own real numbers, so a
        // recovered session that was already past 80% before the crash
        // doesn't spuriously re-fire the warning on its first post-
        // recovery event.
        budgetWarned: record.budgetUsd !== null && record.costUsd >= record.budgetUsd * 0.8,
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
          if (handle) keepWorkers.push(record.id);
        }
        if (!session.handle) {
          session.record.controlMode = "observed";
          this.persist(session.record);
          await this.emitSystem(session, "session.recovered", {
            events: events.length,
            lastSeq,
            controllable: false,
          });
          uncontrolled++;
          continue;
        }
        await this.emitSystem(session, "session.recovered", {
          events: events.length,
          lastSeq,
          controllable: true,
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
    this.metrics?.gauge("recovery_ms", elapsed);
    if (elapsed > 3000) {
      this.logger.warn("recovery exceeded K7 budget", { elapsedMs: Math.round(elapsed), budgetMs: 3000 });
    }
    return { recovered, failed, reaped, uncontrolled };
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
        const logger = this.logger.child({
          adapter: session.record.adapter,
          sessionId: session.record.id,
        });
        logger[level](msg, extra);
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
    this.logger.error("event append failed", { sessionId: session.record.id, err: message });

    try {
      await this.setStatus(session, "error");
    } catch (statusErr) {
      // Late emission after shutdown/cleanup (session already "stopped",
      // no transition to "error" allowed) must never crash the daemon.
      this.logger.error("could not persist error status", {
        sessionId: session.record.id,
        err: statusErr instanceof Error ? statusErr.message : String(statusErr),
      });
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
      this.logger.error("could not surface append failure as an event", {
        sessionId: session.record.id,
        err: retryErr instanceof Error ? retryErr.message : String(retryErr),
      });
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
    let sawCost = false;
    for (const e of events) {
      if (e.costUsd !== undefined) {
        session.record.costUsd += e.costUsd;
        sawCost = true;
      }
      // ADR-0006: same per-event/summed pattern as costUsd, applied to the
      // tokensEst field that already existed on the event contract but was
      // never aggregated onto the session record.
      if (e.tokensEst !== undefined) session.record.tokensEst += e.tokensEst;
      const native = (e.payload as { nativeSessionId?: unknown }).nativeSessionId;
      if (typeof native === "string" && native.length > 0) session.record.nativeSessionId = native;
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
    this.metrics?.inc("events_appended", enforced.length);
    this.persist(session.record);
    for (const sub of session.subscribers) {
      try {
        sub(enforced);
      } catch {
        // a slow/broken subscriber never blocks the stream
      }
    }
    // T2.7: after this event's own subscriber notification, not before —
    // checkBudget/checkDailyCap recurse back into this method for their
    // own park/warning events, which must reach subscribers in their real
    // temporal order (the event that crossed the threshold, then the park
    // that followed), not the other way around. Safe against runaway
    // recursion: a just-parked session is terminal and neither check
    // re-fires for it.
    if (sawCost) {
      await this.checkBudget(session);
      await this.checkDailyCap();
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
      controlMode: session.record.controlMode,
      nativeSessionId: session.record.nativeSessionId,
      resumeVersion: session.record.resumeVersion,
      inputRevision: session.record.inputRevision,
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
        `INSERT INTO sessions (
           id, adapter, project, worktree_sha, model, status, created_at, budget_usd, adapter_version, last_seq,
           cost_usd, updated_at, tokens_est, park_reason, control_mode, harness, host_id, native_session_id,
           resume_version, log_offset, parent_session_id, observed_at, fork, input_revision, writer_client, writer_lease_until,
           archived
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           model = excluded.model,
           worktree_sha = excluded.worktree_sha,
           budget_usd = excluded.budget_usd,
           adapter_version = excluded.adapter_version,
           last_seq = excluded.last_seq,
           cost_usd = excluded.cost_usd,
           updated_at = excluded.updated_at,
           tokens_est = excluded.tokens_est,
           park_reason = excluded.park_reason,
           control_mode = excluded.control_mode,
           harness = excluded.harness,
           host_id = excluded.host_id,
           native_session_id = excluded.native_session_id,
           resume_version = excluded.resume_version,
           log_offset = excluded.log_offset,
           parent_session_id = excluded.parent_session_id,
           observed_at = excluded.observed_at,
           fork = excluded.fork,
           input_revision = excluded.input_revision,
           writer_client = excluded.writer_client,
           writer_lease_until = excluded.writer_lease_until,
           archived = excluded.archived`,
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
        record.parkReason,
        record.controlMode,
        record.harness,
        record.hostId,
        record.nativeSessionId,
        record.resumeVersion,
        record.logOffset,
        record.parentSessionId,
        record.observedAt,
        record.fork ? 1 : 0,
        record.inputRevision,
        record.writerClient,
        record.writerLeaseUntil,
        record.archived ? 1 : 0,
      );
  }

  private toDiscovered(record: SessionRecord): DiscoveredSession {
    return {
      hubSessionId: record.id,
      project: record.project,
      adapter: record.adapter,
      status: record.status,
      controlMode: unsupportedResume(record.resumeVersion) ? "observed" : record.controlMode,
      harness: record.harness,
      hostId: record.hostId,
      nativeSessionId: record.nativeSessionId,
      resumeVersion: record.resumeVersion,
      observedAt: record.observedAt ?? record.updatedAt,
      unsupportedResume: unsupportedResume(record.resumeVersion),
      fork: record.fork,
      parentSessionId: record.parentSessionId,
    };
  }

  private hasSeenInput(sessionId: string, inputId: string): boolean {
    const row = this.db
      .prepare("SELECT input_id FROM session_inputs WHERE session_id = ? AND input_id = ?")
      .get(sessionId, inputId) as { input_id: string } | undefined;
    return row !== undefined;
  }

  private commitSteerMeta(session: LiveSession, meta: SteerMeta | undefined): void {
    session.record.inputRevision += 1;
    if (meta?.clientId) {
      session.record.writerClient = meta.clientId;
      session.record.writerLeaseUntil = new Date(Date.now() + WRITER_LEASE_MS).toISOString();
    }
    this.persist(session.record);
    if (!meta?.inputId) return;
    this.db
      .prepare("INSERT OR IGNORE INTO session_inputs (session_id, input_id, applied_at) VALUES (?, ?, ?)")
      .run(session.record.id, meta.inputId, new Date().toISOString());
  }
}

/** Hash a device token for storage (tokens are shown once at issuance). */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
