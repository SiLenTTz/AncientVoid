import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { ToolPermissionAnswer, ToolPermissionPoll, ToolPermissionRequest, Adapter, AdapterContext, BlobRef, EmittedEvent, HubLogger, HubMetrics, NormalizedEvent, SessionRecord, SessionSnapshot, SessionStatus, SteerInput, Ack, WorkerProcess, WorkerRunner, UsageQuota, ReportingSink, DiscoverySource, DiscoveredSession, HubNotification, PendingOperation } from "@uacc/contracts";
import { DEFAULT_HOST_ID, RESUME_SCHEMA_VERSION, SessionSpec as SessionSpecSchema, unsupportedResume } from "@uacc/contracts";
import type { EventStore } from "../../platform/index.ts";
import type { AdapterRegistry } from "../harness/index.ts";
import type { HubDatabase } from "../../platform/index.ts";
import type { WorktreeManager } from "../workspace/index.ts";
import { refuseSpec, refuseSteer } from "../harness/index.ts";
import { OperationStore } from "../approvals/index.ts";
import { ApprovalFlow, type AgentActionKind } from "./approval-flow.ts";
import { BudgetGuard } from "./budget-guard.ts";
import { ToolPermissions, type ToolGate } from "./tool-permissions.ts";
import type { ApprovalService } from "../approvals/index.ts";
import { buildSessionSummary } from "../reporting/index.ts";
import { createConsoleLogger } from "../../platform/index.ts";
import { dedupeDiscovered, pageDiscovered } from "../discovery/index.ts";
import { resolveSkillChain, withSkillChain } from "../skills/index.ts";
import { notificationFor } from "../notifications/index.ts";
import { WRITER_LEASE_MS, type SteerMeta, type LiveSession, TURN_END_SETTLE_MS, sessionTitle, readSkillName, skillNameFromEvents, nativeIdFromEvents, nativeIdFromWorkerLog, VALID_TRANSITIONS, DEFAULT_HEARTBEAT_MS } from "./session-state.ts";
import { type SessionRow, persistRecord, rowToRecord } from "./session-row.ts";

export interface SessionManagerObservability {
  logger?: HubLogger;
  metrics?: HubMetrics;
}

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

/**
 * Session lifecycle manager.
 *
 * - Sessions are first-class objects persisted in SQLite + JSONL.
 * - Every state change is emitted as a system event (auditable).
 * - K7 crash recovery: replay JSONL + snapshot + optional adapter.recover().
 * - Adapters only ever see AdapterContext — never hub internals.
 */
export class SessionManager {
  private readonly live = new Map<string, LiveSession>();
  private readonly usageByAdapter = new Map<string, AdapterUsageSnapshot>();
  /** ADR-0019: approval-gated prompts and budget top-ups. */
  private readonly flow: ApprovalFlow;
  /** ADR-0019: shared by the approval flow and tool permissions. */
  private readonly operationStore: OperationStore;
  /** T7.2: set by the server (enableToolPermissions). */
  private tools: ToolPermissions | undefined;
  /** T2.7: budget and daily cap. */
  private readonly budget: BudgetGuard;
  /** ADR-0015: when the last provider.error per session was reported. */
  private readonly lastProviderError = new Map<string, number>();
  /** Tail of the per-session steer chain (see steer()). */
  private readonly steerQueue = new Map<string, Promise<void>>();

  private readonly db: HubDatabase;
  private readonly store: EventStore;
  private readonly registry: AdapterRegistry;
  private readonly runner: WorkerRunner;
  private readonly worktrees: WorktreeManager | undefined;
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
    this.operationStore = new OperationStore(db);
    this.budget = new BudgetGuard(
      {
        session: (id) => this.live.get(id),
        sessions: () => this.live.values(),
        records: () => this.list(),
        emitSystem: (session, kind, payload) => this.emitSystem(session, kind, payload),
        park: (session, reason, actor) => this.parkFor(session, reason, actor),
        setStatus: (session, status) => this.setStatus(session, status),
        context: (session) => this.makeContext(session),
        persist: (record) => this.persist(record),
      },
      dailyCapUsd,
    );
    this.flow = new ApprovalFlow(
      {
        session: (id) => this.live.get(id),
        emitSystem: (session, kind, payload) => this.emitSystem(session, kind, payload),
        emitPrompt: (session, text, actor) => this.emitPrompt(session, text, actor),
        continueStopped: (session, input, actor) => this.continueStopped(session, input, actor),
        context: (session) => this.makeContext(session),
        applyBudgetTopUp: (sessionId, usd, actor) => this.applyBudgetTopUp(sessionId, usd, actor),
        createSession: (spec, actor) => this.create(spec, actor),
        stopSession: (sessionId, actor) => this.stop(sessionId, actor),
        parkSession: (sessionId, actor) => this.steer(sessionId, { kind: "park" }, actor),
      },
      approvals,
      this.operationStore,
    );
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
    const s = this.openStopped(sessionId);
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
    const live = this.live.get(sessionId);
    if (live) return live.workdir;
    // Stopped sessions load only when opened (BUG-0018) — their worktree is
    // still the place the session worked in.
    const record = this.get(sessionId);
    if (!record) return undefined;
    const worktree = record.worktreeSha !== null && this.worktrees ? this.worktrees.pathFor(sessionId) : null;
    return worktree && existsSync(worktree) ? worktree : record.project;
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
    const refused = refuseSpec(registered.capabilities.features, parsed.adapter, parsed);
    if (refused) throw new Error(refused);
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
      title: parsed.prompt ? sessionTitle(parsed.prompt) : null,
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
    if (parsed.prompt) await this.emitPrompt(session, parsed.prompt, actor);
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

  /** BUG-0018: a stopped session enters `live` only once someone opens it
   * (tail subscription or steer), never at recovery. The shell is cheap:
   * skill and provider id are read from the log only when the run
   * actually continues (continueStopped). */
  private openStopped(sessionId: string): LiveSession | undefined {
    const existing = this.live.get(sessionId);
    if (existing) return existing;
    const record = this.get(sessionId);
    if (!record || record.status !== "stopped") return undefined;
    const registered = this.registry.get(record.adapter);
    if (!registered) return undefined;
    const isolated =
      record.worktreeSha !== null && this.worktrees !== undefined && existsSync(this.worktrees.pathFor(record.id));
    const workdir = isolated && this.worktrees ? this.worktrees.pathFor(record.id) : record.project;
    const session: LiveSession = {
      record,
      adapter: registered.adapter,
      handle: null,
      abort: new AbortController(),
      subscribers: new Set(),
      workdir,
      worktreeIsolated: isolated,
      budgetWarned: record.budgetUsd !== null && record.costUsd >= record.budgetUsd * 0.8,
    };
    this.live.set(sessionId, session);
    return session;
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
    const session = this.openStopped(sessionId);
    if (!session) {
      const record = this.get(sessionId);
      if (record?.status === "stopped") return { ok: false, detail: `adapter "${record.adapter}" not registered` };
      return { ok: false, detail: "session not live" };
    }
    if (!session.handle && input.kind !== "prompt") return { ok: false, detail: "session not live" };
    if (meta?.inputId && this.hasSeenInput(sessionId, meta.inputId)) {
      return { ok: true, detail: "duplicate input ignored" };
    }
    if (meta?.revision !== undefined && meta.revision !== session.record.inputRevision) {
      return { ok: false, detail: "revision conflict" };
    }
    const leaseUntil = session.record.writerLeaseUntil ? Date.parse(session.record.writerLeaseUntil) : 0;
    const foreignWriter =
      meta?.clientId && session.record.writerClient && session.record.writerClient !== meta.clientId && leaseUntil > Date.now()
        ? session.record.writerClient
        : null;
    if (foreignWriter && !meta?.takeover) return { ok: false, detail: "writer lease held" };
    const features = this.registry.get(session.record.adapter)?.capabilities.features;
    const refused = features ? refuseSteer(features, session.record.adapter, input) : null;
    if (refused) return { ok: false, detail: refused };
    if (input.kind === "stop") {
      if (session.record.status === "stopped") return { ok: true };
      return this.stop(sessionId, actor);
    }
    let delivered = input;
    const reopening = input.kind === "prompt" && (session.record.status === "stopped" || !session.handle);
    if (input.kind === "prompt" && session.skillName && !reopening) {
      delivered = { ...input, text: await this.promptWithSkill(session, input.text) };
    }
    const gated = await this.flow.gateSteer(session, input, delivered, actor);
    if (gated) return gated;
    if (input.kind === "prompt") await this.emitPrompt(session, input.text, actor);
    if (reopening && delivered.kind === "prompt") {
      // BUG-0016: the reopen is a steer like any other — without the
      // commit, a retried input id started the provider a second time.
      const reopened = await this.continueStopped(session, delivered, actor);
      if (reopened.ok) await this.commitSteer(session, meta, foreignWriter, actor);
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
    if (ack.ok) await this.commitSteer(session, meta, foreignWriter, actor);
    return ack;
  }

  /** The user's own input as a chat message — as typed, without the skill
   * chain the hub puts in front for the provider. The hub is the one source
   * for these; adapters no longer echo prompts as `user` events. */
  private async emitPrompt(session: LiveSession, text: string, actor?: string): Promise<void> {
    // A session that had no start prompt takes its first reply as title.
    if (!session.record.title) session.record.title = sessionTitle(text);
    await this.emitEvents(session, [
      { type: "user", summary: text.slice(0, 200), payload: { kind: "session.prompt", text, actor: actor ?? null } },
    ]);
  }

  /** ADR-0015: cross-session notifications, persisted so every device and a
   * restarted hub show the same list. */
  private recordNotifications(session: LiveSession, events: readonly NormalizedEvent[]): void {
    for (const event of events) {
      const kind = (event.payload as { kind?: unknown }).kind;
      if (kind === "provider.error") this.lastProviderError.set(session.record.id, Date.now());
      const draft = notificationFor(event, {
        adapter: session.record.adapter,
        project: session.record.project,
        recentProviderError: Date.now() - (this.lastProviderError.get(session.record.id) ?? 0) < 30_000 && kind !== "provider.error",
      });
      if (!draft) continue;
      this.db
        .prepare("INSERT INTO notifications (session_id, level, title, detail, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(session.record.id, draft.level, draft.title, draft.detail, draft.kind, event.ts);
    }
  }

  /**
   * "Ins Projekt übernehmen": the session's worktree work lands in the
   * project checkout as one merge. Only between turns — never while an
   * agent may still write.
   */
  async applyToProject(
    sessionId: string,
    actor?: string,
  ): Promise<{ ok: true; into: string; commit: string; files: number } | { ok: false; detail: string }> {
    const record = this.get(sessionId);
    if (!record) return { ok: false, detail: "Session unbekannt." };
    if (record.status === "working" || record.status === "starting") {
      return { ok: false, detail: "Die Session arbeitet gerade. Bitte warten, bis der Zug fertig ist." };
    }
    const session = this.openStopped(sessionId) ?? this.live.get(sessionId);
    if (!this.worktrees || record.worktreeSha === null || !existsSync(this.worktrees.pathFor(sessionId)) || !session) {
      return { ok: false, detail: "Diese Session arbeitet direkt im Projektordner, es gibt nichts zu übernehmen." };
    }
    const message = `UACC: ${record.title ?? `Session ${sessionId.slice(0, 8)}`}`;
    const result = await this.worktrees.apply(sessionId, record.project, message);
    if (result.ok) {
      await this.emitSystem(session, "session.applied", { into: result.into, commit: result.commit, files: result.files, actor: actor ?? null });
    }
    return result;
  }

  /** Newest first. With `afterId`, only newer ones (polling). */
  notifications(afterId = 0, limit = 50): { items: HubNotification[]; lastId: number } {
    const rows = this.db
      .prepare("SELECT * FROM notifications WHERE id > ? ORDER BY id DESC LIMIT ?")
      .all(afterId, Math.min(Math.max(limit, 1), 200)) as unknown as {
      id: number;
      session_id: string;
      level: HubNotification["level"];
      title: string;
      detail: string | null;
      kind: string;
      created_at: string;
    }[];
    const last = this.db.prepare("SELECT MAX(id) AS id FROM notifications").get() as { id: number | null };
    return {
      items: rows.map((row) => ({
        id: row.id,
        sessionId: row.session_id,
        level: row.level,
        title: row.title,
        detail: row.detail,
        kind: row.kind,
        createdAt: row.created_at,
      })),
      lastId: last.id ?? 0,
    };
  }

  /** Records a delivered steer and, for a takeover, who handed over to whom. */
  private async commitSteer(session: LiveSession, meta: SteerMeta | undefined, foreignWriter: string | null, actor?: string): Promise<void> {
    this.commitSteerMeta(session, meta);
    if (foreignWriter && meta?.clientId) {
      await this.emitSystem(session, "session.writer_takeover", { from: foreignWriter, to: meta.clientId, actor: actor ?? null });
    }
  }













  /** ADR-0019: see ApprovalFlow. */
  applyApprovedSteer(approvalId: string, decidedByLabel?: string): Promise<Ack> {
    return this.flow.applyApprovedSteer(approvalId, decidedByLabel);
  }

  requestBudgetTopUp(sessionId: string, newBudgetUsd: number, reason?: string, actor?: string): Promise<Ack & { approvalId?: string }> {
    return this.flow.requestBudgetTopUp(sessionId, newBudgetUsd, reason, actor);
  }

  recordApprovalDecision(sessionId: string, approvalId: string, action: string, status: "approved" | "rejected", decidedByLabel: string): Promise<void> {
    return this.flow.recordApprovalDecision(sessionId, approvalId, action, status, decidedByLabel);
  }

  applyApprovedBudgetTopUp(approvalId: string, decidedByLabel?: string): Promise<Ack> {
    return this.flow.applyApprovedBudgetTopUp(approvalId, decidedByLabel);
  }

  operation(id: string): PendingOperation | undefined {
    return this.flow.operation(id);
  }

  /**
   * T7.2 / ADR-0018 §3: native tool permissions. The server wires the
   * approval service (always, independent of `requireStepApprovals`) and
   * the bridge that lets a provider ask.
   */
  enableToolPermissions(gate: ToolGate): void {
    this.flow.useHumanGate(gate.approvals);
    this.tools = new ToolPermissions(
      {
        session: (id) => this.live.get(id),
        setStatus: (session, status) => this.setStatus(session, status),
        emitEvents: (session, events) => this.emitEvents(session, events),
      },
      this.operationStore,
      gate,
    );
  }

  /** T7.4: see ApprovalFlow.requestAgentAction. */
  requestAgentAction(kind: AgentActionKind, sessionId: string | null, payload: Record<string, unknown>, actor: string): Promise<Ack & { approvalId?: string }> {
    return this.flow.requestAgentAction(kind, sessionId, payload, actor);
  }

  /** T7.4: runs what an approval released (any operation kind). */
  applyApproved(approvalId: string, decidedByLabel?: string): Promise<Ack> {
    return this.flow.applyApproved(approvalId, decidedByLabel);
  }

  /** T7.2: see ToolPermissions. */
  requestToolPermission(sessionId: string, req: ToolPermissionRequest): Promise<{ ok: true; id: string } | { ok: false; detail: string }> {
    return this.tools ? this.tools.request(sessionId, req) : Promise.resolve({ ok: false, detail: "tool permissions not enabled" });
  }

  answerToolQuestion(id: string, answers: Record<string, string>): boolean {
    return this.tools?.answerQuestion(id, answers) ?? false;
  }

  pollToolPermission(sessionId: string, id: string): Promise<ToolPermissionPoll | undefined> {
    return this.tools ? this.tools.poll(sessionId, id) : Promise.resolve(undefined);
  }

  /** T2.7: see BudgetGuard. */
  applyBudgetTopUp(sessionId: string, newBudgetUsd: number, actor?: string): Promise<Ack> {
    return this.budget.applyBudgetTopUp(sessionId, newBudgetUsd, actor);
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
      // it — but only a clean one. BUG-0027: `remove --force` + `branch -D`
      // destroyed every uncommitted file and commit an agent had made.
      // A worktree with work stays, and "Weiter" continues in it.
      // Removal failures are a disk-hygiene problem to surface, not a
      // reason to leave the session stuck in "stopping".
      if (session.worktreeIsolated && this.worktrees) {
        try {
          if (await this.worktrees.hasWork(session.record.id, session.record.worktreeSha, session.record.project)) {
            await this.emitSystem(session, "session.worktree_kept", {
              path: this.worktrees.pathFor(session.record.id),
              branch: this.worktrees.branchFor(session.record.id),
            });
          } else {
            await this.worktrees.remove(session.record.id, session.record.project);
          }
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
        // Loaded when opened (openStopped), so recovery time does not grow
        // with the history of finished runs.
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
          // T5.6: resumable, but no turn survived the restart — between turns.
          if (handle && session.adopted === false && session.record.status === "working") {
            await this.setStatus(session, "idle");
          }
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

    await this.flow.reconcile();
    const reaped = await this.runner.reapOrphans(keepWorkers).catch(() => []);
    const elapsed = performance.now() - t0;
    this.metrics?.gauge("recovery_ms", elapsed);
    if (elapsed > 3000) {
      this.logger.warn("recovery exceeded K7 budget", { elapsedMs: Math.round(elapsed), budgetMs: 3000 });
    }
    return { recovered, failed, reaped, uncontrolled };
  }





  /**
   * `keepWorkers`: a planned restart with a runner whose workers outlive
   * the hub (tmux). Sessions keep their status and running turns go on;
   * the next start adopts them like after a crash (ADR-0014). Without it,
   * every session is stopped — workers that die with the hub.
   */
  async shutdown(options: { keepWorkers?: boolean } = {}): Promise<void> {
    clearInterval(this.heartbeatTimer);
    if (options.keepWorkers) {
      await this.store.flush();
      return;
    }
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
        const proc = await this.runner.spawn({
          name: session.record.id,
          cwd: session.workdir,
          cmd,
          ...(opts?.env !== undefined ? { env: opts.env } : {}),
          ...(opts?.cols !== undefined ? { cols: opts.cols } : {}),
          ...(opts?.rows !== undefined ? { rows: opts.rows } : {}),
          ...(opts?.stdin !== undefined ? { stdin: opts.stdin } : {}),
        });
        // ADR-0013 Nachtrag: a persistent agent is not a turn — the adapter
        // reports turns through ctx.turn().
        if (!opts?.persistent) await this.trackTurn(session, proc);
        return proc;
      },
      adoptWorker: async (opts) => {
        const proc = (await this.runner.adopt?.(session.record.id)) ?? null;
        session.adopted = proc !== null;
        if (proc && !opts?.persistent) await this.trackTurn(session, proc);
        return proc;
      },
      turn: (state) => {
        void this.adapterTurn(session, state).catch((err) => this.logger.warn("turn state not recorded", { sessionId: session.record.id, err: String(err) }));
      },
      get nativeSessionId() {
        return session.record.nativeSessionId;
      },
      ...(this.tools?.bridge ? { permissionBridge: () => this.tools!.bridge!(session.record.id) } : {}),
      ...(this.tools ? { requestToolPermission: (req: ToolPermissionRequest) => this.awaitToolPermission(session, req) } : {}),
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
    this.recordNotifications(session, enforced);
    // T2.7: after this event's own subscriber notification, not before —
    // checkBudget/checkDailyCap recurse back into this method for their
    // own park/warning events, which must reach subscribers in their real
    // temporal order (the event that crossed the threshold, then the park
    // that followed), not the other way around. Safe against runaway
    // recursion: a just-parked session is terminal and neither check
    // re-fires for it.
    if (sawCost) {
      await this.budget.check(session);
      await this.budget.checkDailyCap();
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

  /**
   * T5.4 / ADR-0013: every CLI adapter runs one worker process per turn, and
   * every worker is spawned through this context. A new worker makes the
   * session `working`; the last one exiting cleanly makes it `idle` (between
   * turns). A failed exit leaves the status to the adapter/heartbeat path.
   */
  /** ADR-0013 Nachtrag: turns reported by an adapter with a persistent worker. */
  private async adapterTurn(session: LiveSession, state: "working" | "idle"): Promise<void> {
    if (state === "working") {
      if (session.record.status === "idle" || session.record.status === "error") await this.setStatus(session, "working");
      return;
    }
    if (session.record.status !== "working") return;
    await this.setStatus(session, "idle");
    await this.emitSystem(session, "session.turn_end", { code: 0 });
  }

  /** T7.2: an in-process adapter waits for the phone's decision. */
  private async awaitToolPermission(session: LiveSession, req: ToolPermissionRequest): Promise<ToolPermissionAnswer> {
    const tools = this.tools!;
    const asked = await tools.request(session.record.id, req);
    if (!asked.ok) return { behavior: "deny", message: `Freigabe nicht möglich (${asked.detail}) — nicht ausgeführt.` };
    for (;;) {
      if (session.abort.signal.aborted) return { behavior: "deny", message: "Session beendet — nicht ausgeführt." };
      const poll = await tools.poll(session.record.id, asked.id);
      if (!poll) return { behavior: "deny", message: "Anfrage nicht mehr bekannt — nicht ausgeführt." };
      if (poll.state === "answered") return poll.answer;
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  private async trackTurn(session: LiveSession, proc: WorkerProcess): Promise<void> {
    session.activeWorkers = (session.activeWorkers ?? 0) + 1;
    if (session.record.status === "idle" || session.record.status === "error") await this.setStatus(session, "working");
    proc.onExit((code) => {
      session.activeWorkers = Math.max(0, (session.activeWorkers ?? 1) - 1);
      if (code !== 0) return;
      setTimeout(() => {
        if ((session.activeWorkers ?? 0) > 0 || session.record.status !== "working") return;
        void this.setStatus(session, "idle")
          .then(() => this.emitSystem(session, "session.turn_end", { code }))
          .catch((err) => this.logger.warn("turn end not recorded", { sessionId: session.record.id, err: String(err) }));
      }, TURN_END_SETTLE_MS).unref();
    });
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
    persistRecord(this.db, record);
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
