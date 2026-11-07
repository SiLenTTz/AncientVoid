import { SessionInterruption } from "./session-interruption.ts";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { PromptAttachment, ToolPermissionAnswer, ToolPermissionPoll, ToolPermissionRequest, Adapter, SessionMetricsState, AdapterContext, BlobRef, EmittedEvent, HubLogger, HubMetrics, NormalizedEvent, SessionRecord, SessionSnapshot, SessionSpec, SessionStatus, SteerInput, Ack, WorkerProcess, WorkerRunner, UsageQuota, ReportingSink, DiscoverySource, DiscoveredSession, HubNotification, PendingOperation, RunEstimate, TurnMetric, WorkspaceManifest, WorkspaceServiceStatus, WorkspaceSetupApproval, WorkspaceStatus } from "@ancientvoid/contracts";
import { actorKind, countMetrics, emptyMetricCounters, metricsState, promptWithAttachments, DEFAULT_HOST_ID, RESUME_SCHEMA_VERSION, SessionSpec as SessionSpecSchema, isLoopAdapter, unsupportedResume } from "@ancientvoid/contracts";
import type { EventStore } from "../../platform/index.ts";
import type { AdapterRegistry } from "../harness/index.ts";
import type { HubDatabase } from "../../platform/index.ts";
import type { WorktreeManager } from "../workspace/index.ts";
import { WorkspaceRuntime, ManifestApprovalStore, ServiceSupervisor, foldWorkspaceState, gateManifest, resolveManifest } from "../workspace/index.ts";
import { refuseSpec, refuseSteer } from "../harness/index.ts";
import { OperationStore } from "../approvals/index.ts";
import { ApprovalFlow, type AgentActionKind } from "./approval-flow.ts";
import { BudgetGuard } from "./budget-guard.ts";
import { ToolPermissions, type ToolGate } from "./tool-permissions.ts";
import type { ApprovalService } from "../approvals/index.ts";
import { buildSessionSummary } from "../reporting/index.ts";
import { createConsoleLogger } from "../../platform/index.ts";
import { dedupeDiscovered, filterDiscovered, pageDiscovered } from "../discovery/index.ts";
import { resolveSkillChain, withSkillChain } from "../skills/index.ts";
import { notificationFor } from "../notifications/index.ts";
import { deriveTurnMetrics, TurnMetricStore } from "../runs/index.ts";
import { buildHandoverPrompt, HANDOVER_PROMPT_MAX } from "../handover/index.ts";
import { SessionQueue, type QueuedPrompt } from "./session-queue.ts";
import { askTitleModel } from "./session-title.ts";
import type { PlannerModelConfig } from "../commands/model.ts";
import { WRITER_LEASE_MS, type SteerMeta, type LiveSession, TURN_END_SETTLE_MS, sessionTitle, activityOf, readSkillName, skillNameFromEvents, nativeIdFromEvents, nativeIdFromWorkerLog, VALID_TRANSITIONS, DEFAULT_HEARTBEAT_MS, DEFAULT_STEER_WAIT_MS } from "./session-state.ts";
import { defaultOpencodeDataDir, readOpenCodeMirrorDelta } from "../discovery/index.ts";
import { type SessionRow, persistRecord, rowToRecord } from "./session-row.ts";

export interface SessionManagerObservability {
  autoResumeInterrupted?: boolean;
  logger?: HubLogger;
  metrics?: HubMetrics;
  /** K7 budget for recoverAll in ms (default 3000); tests lower it. */
  recoveryBudgetMs?: number;
  /** T17.4: hard cap for the hub's wait on one adapter submission in ms
   * (default 30_000, see DEFAULT_STEER_WAIT_MS); tests lower it. There is
   * deliberately no "0 = off" — no unbounded waits in the server. */
  steerWaitMs?: number;
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

/** BUG-0050: how many sessions are recovered at the same time. */
const RECOVERY_CONCURRENCY = 6;

/** T17.4: the one honest answer once a submission wait ran out — the
 * attempt may still land late; whether it did is for the session's own
 * tail to answer, never a second submission of the same input id
 * (Herdr lesson: a timeout does not prove that no input was sent). */
const STEER_TIMEOUT_DETAIL = "steer timeout — unclear whether the input arrived; read the session before retrying";

/** Runs `fn` over `items` with at most `limit` in flight; results keep the input order. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Session lifecycle manager.
 *
 * - Sessions are first-class objects persisted in SQLite + JSONL.
 * - Every state change is emitted as a system event (auditable).
 * - K7 crash recovery: replay JSONL + snapshot + optional adapter.recover().
 * - Adapters only ever see AdapterContext — never hub internals.
 */
/** 2026-10-26: a registration's `config.model` (the same field
 * /api/adapters/:id/models reports as defaultModel). */
function defaultModelOf(registered: { config?: Readonly<Record<string, unknown>> }): string | null {
  const model = registered.config?.model;
  return typeof model === "string" && model.length > 0 ? model : null;
}

export class SessionManager {
  private readonly interruption: SessionInterruption;
  private readonly autoResumeInterrupted: boolean;
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
  /** T17.4: input ids with a submission still running — its wait may have
   * timed out; until the attempt settles the outcome is unknown, and the
   * same id is never submitted twice. */
  private readonly inFlightInputs = new Map<string, Set<string>>();
  /** T17.4: hard cap for the hub's wait on one adapter submission. */
  private readonly steerWaitMs: number;

  private readonly db: HubDatabase;
  private readonly store: EventStore;
  private readonly registry: AdapterRegistry;
  private readonly runner: WorkerRunner;
  private readonly worktrees: WorktreeManager | undefined;
  /** EPIC-P29 (ADR-0051): Setup/Teardown-Operationen, Hash-Freigaben, Services. */
  private readonly workspaces: WorkspaceRuntime;
  private readonly workspaceServices: ServiceSupervisor;
  private readonly manifestApprovals: ManifestApprovalStore;
  private readonly approvals: ApprovalService | undefined;
  /** EPIC-P29: die Manifest-Freigabe hängt an der immer vorhandenen Queue —
   * unabhängig von `requireStepApprovals` (das steuert nur steer.prompt). */
  private workspaceApprovals: ApprovalService | undefined;
  private readonly recoveryBudgetMs: number;
  private readonly mirrorDataDir: string;
  private readonly defaultPermissionMode: string | null;
  private readonly queue: SessionQueue;
  private readonly turnMetricStore: TurnMetricStore;
  private titleModel: PlannerModelConfig | undefined;
  private readonly draining = new Set<string>();
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
    /** Read-only opencode mirror (ADR-0011 Erweiterung): the data dir whose
     * opencode.db mirror sessions read. Defaults to the same dir the
     * discovery scan uses; tests inject their own fixture dir. */
    mirrorDataDir: string = defaultOpencodeDataDir(),
    /** ADR-0033: the mode new sessions start in, where the adapter offers it. */
    defaultPermissionMode: string | null = null,
  ) {
    this.autoResumeInterrupted = observability.autoResumeInterrupted ?? false;
    this.interruption = new SessionInterruption({
      replay: (id) => this.store.replay(id),
      setStatus: (session, status) => this.setStatus(session, status),
      emit: (session, kind, payload) => this.emitSystem(session, kind, payload),
      digest: (session) => this.dispatchDigest(session),
      stop: (session) => session.adapter.stop(session.handle!, this.makeContext(session)),
      autoResume: (session) => this.autoResumeInterrupted && this.registry.get(session.record.adapter)?.capabilities.resume?.auto === true
        ? this.resume(session.record.id, "auto-resume") : Promise.resolve({ ok: false }),
    });
    this.defaultPermissionMode = defaultPermissionMode;
    this.queue = new SessionQueue(db);
    this.turnMetricStore = new TurnMetricStore(db);
    this.mirrorDataDir = mirrorDataDir;
    this.db = db;
    this.store = store;
    this.registry = registry;
    this.runner = runner;
    this.worktrees = worktrees;
    this.approvals = approvals;
    this.workspaceServices = new ServiceSupervisor(db, store, store.directory());
    this.workspaces = new WorkspaceRuntime(db, store, this.workspaceServices);
    this.manifestApprovals = new ManifestApprovalStore(db);
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
        emitPrompt: (session, text, actor, attachments) => this.emitPrompt(session, text, actor, attachments),
        forAdapter: (session, input) => this.withAttachments(session, input),
        continueStopped: (session, input, actor) => this.continueStopped(session, input, actor),
        context: (session) => this.makeContext(session),
        applyBudgetTopUp: (sessionId, usd, actor) => this.applyBudgetTopUp(sessionId, usd, actor),
        createSession: (spec, actor) => this.create(spec, actor),
        stopSession: (sessionId, actor) => this.stop(sessionId, actor),
        parkSession: (sessionId, actor) => this.steer(sessionId, { kind: "park" }, actor),
        resolveWorkspaceSetup: (op, decidedByLabel) => this.resolveWorkspaceSetup(op, decidedByLabel),
      },
      approvals,
      this.operationStore,
    );
    this.reportingSinks = reportingSinks;
    this.logger = observability.logger ?? createConsoleLogger();
    this.metrics = observability.metrics;
    this.recoveryBudgetMs = observability.recoveryBudgetMs ?? 3000;
    this.steerWaitMs = observability.steerWaitMs ?? DEFAULT_STEER_WAIT_MS;
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
        const terminal = session.record.status === "stopped" || session.record.status === "error" || session.record.status === "interrupted" || (session.record.status === "parked" && !session.persistentWorker);
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
          if (isLoopAdapter(session.record.adapter) || !VALID_TRANSITIONS[session.record.status].includes("interrupted")) {
            await this.setStatus(session, "error");
          } else await this.interruption.interrupt(session, "adapter_down");
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
   *
   * Clip observers (cursor/claude-clip, external IDE chats) stay out —
   * they bury the real sessions (user decision 2026-09-28); a hub-managed
   * clip session is a real session and stays.
   */
  async discover(
    sources: readonly DiscoverySource[] = [],
    cursor = 0,
    limit = 50,
    query: { q?: string; adapter?: string } = {},
  ): Promise<{ items: DiscoveredSession[]; nextCursor: number | null }> {
    const external: DiscoveredSession[] = [];
    for (const source of sources) external.push(...(await source.list()));
    const records = this.list();
    const hubIds = new Set(records.map((record) => record.id));
    const merged = dedupeDiscovered([...records.map((record) => this.toDiscovered(record)), ...external]).filter(
      (item) =>
        !(item.hubSessionId === null && (item.adapter === "cursor-clip" || item.adapter === "claude-clip")) &&
        // ADR-0041: a run inside one of this hub's own worktrees IS that hub session — listing the harness's
        // file as a second, "external" row (older sessions never reported a native id) only doubles it.
        !(item.hubSessionId === null && hubIds.has(/\/data\/worktrees\/([0-9a-f-]{36})(?:\/|$)/.exec(item.project)?.[1] ?? "")),
    );
    // BUG-0035: page 1 is what the user opens — the most recently observed
    // first, never the source's oldest scan order. Items without a
    // timestamp sink; ISO-8601 compares chronologically as a string.
    merged.sort((a, b) => (b.observedAt ?? "").localeCompare(a.observedAt ?? ""));
    return pageDiscovered(filterDiscovered(merged, query), cursor, limit);
  }

  async hasLiveWorker(sessionId: string): Promise<boolean> {
    const workers = await this.runner.list();
    // T17.6: marker first; the name stays for runners/workers without one.
    return workers.some((worker) => worker.sessionId === sessionId || worker.name === sessionId);
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

  /** T7.6: hub-side work (registered actions) in a live session's timeline.
   * A session without a live process gets none — the run is still listed. */
  async recordHubEvents(sessionId: string, events: EmittedEvent[]): Promise<boolean> {
    const live = this.live.get(sessionId);
    if (!live) return false;
    await this.emitEvents(live, events);
    return true;
  }

  require(sessionId: string): SessionRecord {
    const rec = this.get(sessionId);
    if (!rec) throw new Error(`unknown session ${sessionId}`);
    return rec;
  }

  /** Hide or restore a session in the overview. Does not stop the worker. */
  /** T8.6: rename or pin — the overview's own metadata, no event. */
  setMeta(sessionId: string, meta: { title?: string | null; pinned?: boolean }): SessionRecord {
    const live = this.live.get(sessionId);
    const record = live?.record ?? this.require(sessionId);
    if (meta.title !== undefined) {
      record.title = meta.title?.trim() ? meta.title.trim().slice(0, 80) : null;
      // A person's own title is never replaced; clearing it hands the job back.
      record.titleSource = record.title ? "manual" : "auto";
    }
    if (meta.pinned !== undefined) record.pinned = meta.pinned;
    this.persist(record);
    return record;
  }

  setArchived(sessionId: string, archived: boolean): SessionRecord {
    const live = this.live.get(sessionId);
    const record = live?.record ?? this.require(sessionId);
    record.archived = archived;
    record.updatedAt = new Date().toISOString();
    this.persist(record);
    return record;
  }

  /**
   * EPIC-P14: archive a session and free its worktree when that loses nothing.
   * The flag is persisted first and never depends on the cleanup. The worktree
   * stays (and the session says why) while a turn runs, while a long-lived
   * worker has it as cwd, or when it holds work (BUG-0027: `hasWork`).
   */
  async archive(sessionId: string, archived: boolean, actor?: string): Promise<SessionRecord> {
    await this.interruption.settled(sessionId);
    let servicesAlreadyStopped = false;
    if (archived && this.get(sessionId)?.status === "interrupted") {
      this.openStopped(sessionId);
      await this.stop(sessionId, actor);
      servicesAlreadyStopped = true;
    }
    const record = this.setArchived(sessionId, archived);
    if (archived) {
      // EPIC-P29 T29.5 (ADR-0051 §3): eigene Services beenden, genehmigten
      // Teardown ausführen (idempotent — genau einmal), DANACH die
      // P14-Prüfungen. Teardown-Fehler ⇒ Worktree bleibt mit Grund.
      const live = this.live.get(sessionId);
      if (live && !servicesAlreadyStopped) {
        await this.workspaceServices
          .stopAll(sessionId, (kind, payload) => this.emitSystem(live, kind, payload))
          .catch((err) => this.logger.warn("service stop on archive failed", { sessionId, err: err instanceof Error ? err.message : String(err) }));
      }
      const teardown = await this.teardownWorkspaceOnce(sessionId, actor);
      if (teardown === "failed") return record;
      await this.tidyWorktree(sessionId);
      const folded = live?.workspace ?? (live ? foldWorkspaceState(await this.store.replay(sessionId)) : null);
      if (live && folded && this.worktrees && !existsSync(this.worktrees.pathFor(sessionId))) {
        await this.emitSystem(live, "workspace.archived", { manifestHash: folded.manifestHash ?? null });
      }
    }
    return record;
  }

  /**
   * EPIC-P29 T29.5: genehmigte Teardown-Schritte — genau einmal pro Session
   * (Journal-Gedächtnis), nur solange der Worktree existiert. `failed` heißt:
   * workspace.cleanup_failed ist emittiert, der Worktree muss bleiben.
   * `none` = kein Workspace/kein Worktree (Migrationsregel).
   */
  private async teardownWorkspaceOnce(sessionId: string, actor?: string): Promise<"none" | "ok" | "failed"> {
    const live = this.live.get(sessionId) ?? this.openStopped(sessionId);
    const record = live?.record ?? this.get(sessionId);
    if (!live || !record || !this.worktrees || record.worktreeSha === null) return "none";
    if (!existsSync(this.worktrees.pathFor(sessionId))) return "none"; // schon entsorgt — nichts zu tun
    if (live.workspace === undefined) {
      const folded = foldWorkspaceState(await this.store.replay(sessionId));
      if (!folded) return "none";
      live.workspace = { phase: folded.phase, manifestHash: folded.manifestHash ?? "", baseSha: record.worktreeSha, pendingApprovalId: null };
    }
    const prior = this.workspaces.listJournal(sessionId).filter((row) => row.kind === "teardown").at(-1);
    if (prior) return prior.state === "failed" ? "failed" : "ok"; // genau einmal, Ergebnis bleibt
    const resolved = await resolveManifest(record.project, record.worktreeSha);
    if (resolved.status !== "ok" || !(resolved.manifest.teardown ?? []).length) return "ok"; // nichts deklariert
    const result = await this.workspaces.runTeardown({
      sessionId,
      project: record.project,
      manifest: resolved.manifest,
      manifestHash: live.workspace.manifestHash || resolved.manifestHash,
      worktreePath: this.worktrees.pathFor(sessionId),
      actor: actor ?? null,
      emit: (kind, payload) => this.emitSystem(live, kind, payload),
    });
    return result.ok ? "ok" : "failed";
  }

  private async tidyWorktree(sessionId: string): Promise<void> {
    const live = this.live.get(sessionId);
    const record = live?.record ?? this.get(sessionId);
    if (!record || !this.worktrees || record.worktreeSha === null) return;
    if (!existsSync(this.worktrees.pathFor(sessionId))) return;
    const base = { path: this.worktrees.pathFor(sessionId), branch: this.worktrees.branchFor(sessionId) };
    const note = async (kind: string, payload: Record<string, unknown>) => {
      if (live) await this.emitSystem(live, kind, payload);
      else this.logger.info(kind, { sessionId, ...payload });
    };
    const betweenTurns = record.status === "idle" || record.status === "stopped" || record.status === "error" || record.status === "parked";
    if (!betweenTurns) return void (await note("session.worktree_kept", { ...base, reason: "running" }));
    if (live?.persistentWorker) return void (await note("session.worktree_kept", { ...base, reason: "worker" }));
    try {
      if (await this.worktrees.hasWork(sessionId, record.worktreeSha, record.project)) {
        await note("session.worktree_kept", { ...base, reason: "work" });
      } else {
        await this.worktrees.remove(sessionId, record.project);
      }
    } catch (err) {
      await note("session.worktree_cleanup_failed", { error: err instanceof Error ? err.message : String(err) });
    }
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
  async create(spec: unknown, actor?: string, options: { workInProject?: boolean } = {}): Promise<SessionRecord> {
    const requested = SessionSpecSchema.parse(spec);
    if (requested.mirrorNativeSessionId) return this.createMirror(requested, actor);
    const registered = this.registry.require(requested.adapter);
    // ADR-0033: an explicit mode wins; otherwise the hub default, but only where the adapter has that mode.
    const asked = (requested.args as { permissionMode?: unknown } | undefined)?.permissionMode;
    const permissionMode =
      typeof asked === "string" && asked
        ? asked
        : this.defaultPermissionMode && registered.capabilities.features.permissionModes.includes(this.defaultPermissionMode)
          ? this.defaultPermissionMode
          : null;
    const parsed = permissionMode ? { ...requested, args: { ...requested.args, permissionMode } } : requested;
    const refused = refuseSpec(registered.capabilities.features, parsed.adapter, parsed);
    if (refused) throw new Error(refused);
    const now = new Date().toISOString();
    const record: SessionRecord = {
      id: randomUUID(),
      adapter: parsed.adapter,
      project: parsed.project,
      worktreeSha: null,
      // 2026-10-26: a session without an explicit model still shows WHICH
      // model runs — the registration's configured default (e.g. pi → the
      // evox2 qwen) fills the record; without any default it stays null and
      // the UI honestly says "Standardmodell" instead of guessing.
      model: parsed.model ?? defaultModelOf(registered) ?? null,
      permissionMode,
      status: "starting",
      createdAt: now,
      budgetUsd: parsed.budgetUsd ?? null,
      adapterVersion: registered.adapter.version,
      lastSeq: 0,
      costUsd: 0,
      updatedAt: now,
      tokensEst: 0,
      metrics: metricsState(emptyMetricCounters()),
      lastActivity: null,
      pinned: false,
      parkReason: null,
      controlMode: "managed",
      harness: "cli",
      hostId: DEFAULT_HOST_ID,
      // Adoption (ADR-0011): a hub-adopted external run keeps its native id —
      // the first prompt resumes it instead of starting a fresh run.
      nativeSessionId: parsed.adoptNativeSessionId ?? null,
      resumeVersion: RESUME_SCHEMA_VERSION,
      logOffset: null,
      parentSessionId: null,
      observedAt: null,
      fork: parsed.adoptNativeSessionId !== undefined && parsed.adoptFork === true,
      inputRevision: 0,
      writerClient: null,
      writerLeaseUntil: null,
      archived: false,
      title: parsed.prompt ? sessionTitle(parsed.prompt) : (parsed.title ?? null),
      titleSource: "auto",
      persistentWorker: false,
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
      ...(parsed.prompt ? { titlePrompt: parsed.prompt } : {}),
    };
    this.live.set(record.id, session);

    // T2.1: attempt real worktree isolation before anything else touches
    // the filesystem. A non-git `project` (dummy-adapter tests, or a
    // genuinely non-git project directory) is a real, honest fallback —
    // not an error — surfaced as its own system event rather than silently
    // running unisolated (AGENTS.md Regel 6).
    // EPIC-P19: ein Loop arbeitet im Projekt des Loop-Systems selbst, eine Hub-Kopie davon wäre die falsche Stelle.
    // ADR-0041: die Übernahme der Originalsession (ohne Kopie) läuft dort weiter, wo sie entstand — omp bricht
    // `session/load` aus einem anderen Verzeichnis ab, und die Session gehört ohnehin diesem Projekt.
    const adoptsInPlace = parsed.adoptNativeSessionId !== undefined && parsed.adoptFork !== true;
    let worktreeCreated: { path: string; baseSha: string } | null = null;
    if (this.worktrees && !options.workInProject && !isLoopAdapter(record.adapter) && !adoptsInPlace) {
      try {
        const created = await this.worktrees.create(record.id, record.project);
        if (created) {
          worktreeCreated = created;
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
        reason: options.workInProject ? "factory driver works in its own project" : isLoopAdapter(record.adapter) ? "loop works in its own project" : adoptsInPlace ? "adopted session continues in its own project" : this.worktrees ? "project is not a git repo" : "worktree isolation not configured",
      });
    }

    const skillName = readSkillName(parsed.args);
    let startSpec = parsed;
    if (parsed.adoptNativeSessionId) {
      // Adoption: the first start resumes the adopted native session; the
      // adapter's own args schema (opencode/claude: resumeSessionId) picks
      // it up and turns the prompt into a continuation. BUG-0039: the hub
      // never had this history — importHistory tells the adapter to emit
      // the load replay instead of discarding it (BUG-0036 is recovery's
      // silence, not adoption's).
      startSpec = { ...startSpec, args: { ...startSpec.args, resumeSessionId: parsed.adoptNativeSessionId, importHistory: true, ...(parsed.adoptFork ? { forkSession: true } : {}) } };
    }
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
    if (parsed.prompt || parsed.attachments?.length) await this.emitPrompt(session, parsed.prompt ?? "", actor, parsed.attachments);
    if (startSpec.attachments?.length) {
      const converted = this.withAttachments(session, { text: startSpec.prompt ?? "", attachments: startSpec.attachments });
      startSpec = { ...startSpec, prompt: converted.text, ...(converted.attachments ? { attachments: converted.attachments } : { attachments: undefined }) };
    }
    // EPIC-P29 T29.3 (ADR-0051 §3): bei einem Manifest an der Basis-SHA
    // läuft Freigabe + Include + Setup VOR dem Agenten — der Agent startet
    // nie in einem unvorbereiteten Workspace (AC-P29-3). Ohne Manifest
    // bleibt exakt der alte T2.1-Pfad (Migrationsregel, ADR-0051 §7).
    if (worktreeCreated) {
      const ready = await this.gateWorkspace(session, worktreeCreated.baseSha, startSpec, actor);
      if (!ready) return { ...record }; // wartet auf Freigabe oder ist fehlerhaft
    }
    const adoptedIdle = parsed.adoptNativeSessionId !== undefined && !parsed.prompt && !parsed.attachments?.length;
    await this.launchAdapter(session, startSpec, adoptedIdle);
    return { ...record };
  }

  /** EPIC-P29: der Adapter-Start, aus create() extrahiert — auch die
   * Freigabe-Fortsetzung (resolveWorkspaceSetup) startet hier. */
  private async launchAdapter(session: LiveSession, startSpec: SessionSpec, adoptedIdle: boolean): Promise<void> {
    try {
      session.handle = await session.adapter.start(startSpec, this.makeContext(session));
      // BUG-0039: an adoption without a prompt has no turn — the history
      // import already happened inside start(). "working" would lie (the
      // PWA shows the loading state for a working session with no events).
      await this.setStatus(session, adoptedIdle ? "idle" : "working");
      await this.emitSystem(session, "session.started", {
        pid: session.handle.pid ?? null,
        capabilities: this.registry.get(session.record.adapter)?.capabilities,
      });
      this.metrics?.inc("sessions_started");
      this.logger.info("session started", {
        sessionId: session.record.id,
        adapter: session.record.adapter,
      });
    } catch (err) {
      await this.setStatus(session, "error");
      await this.emitSystem(session, "session.start_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * EPIC-P29 T29.3: Manifest auflösen, Freigabe prüfen, Setup ausführen.
   * `false` heißt: die Session wartet auf einen Menschen oder ist im
   * Fehlerzustand — der Agent startet nicht. `startSpec` wird nur für den
   * Freigabe-Fall persistiert (Operation), damit die Entscheidung nach
   * einem Hub-Crash den Originalstart sauber fortsetzen kann (ADR-0019).
   */
  private async gateWorkspace(
    session: LiveSession,
    baseSha: string,
    startSpec: SessionSpec,
    actor?: string,
  ): Promise<boolean> {
    const resolved = await resolveManifest(session.record.project, baseSha);
    if (resolved.status === "none") return true; // Migrationsregel: kein Manifest, kein Workspace
    if (resolved.status === "invalid") {
      await this.failWorkspace(session, resolved.manifestHash, baseSha, { step: "manifest", kind: "unknown", detail: resolved.reason, logBlobRef: null });
      return false;
    }
    const gate = gateManifest(resolved, session.record.project, baseSha, this.manifestApprovals);
    if (gate.ok) return await this.runWorkspaceSetup(session, gate.manifest, gate.manifestHash, baseSha, actor ?? null, "setup");
    if (gate.kind !== "approval_required") {
      // bei gültigem Resolver-Ergebnis unerreichbar — trotzdem laut, nie still
      await this.failWorkspace(session, resolved.manifestHash, baseSha, { step: "manifest", kind: "unknown", detail: gate.reason, logBlobRef: null });
      return false;
    }
    const approvalQueue = this.workspaceApprovals ?? this.approvals;
    if (!approvalQueue) {
      await this.failWorkspace(session, resolved.manifestHash, baseSha, { step: "approval", kind: "unknown", detail: "Workspace-Manifest braucht eine menschliche Freigabe — es ist keine Freigabe-Warteschlange konfiguriert.", logBlobRef: null });
      return false;
    }
    const { manifest } = gate.approval;
    const summary = `Workspace-Manifest ${gate.approval.manifestHash.slice(0, 12)}… für ${session.record.project.split("/").pop()}: ${manifest.setup?.length ?? 0} Setup-Schritte, ${manifest.include?.length ?? 0} Dateien, ${manifest.services?.length ?? 0} Services`;
    const request = approvalQueue.create(session.record.id, "write", "workspace.setup", summary, false, 24 * 60 * 60 * 1000);
    this.operationStore.create(request.id, session.record.id, "workspace.setup", { approval: gate.approval, startSpec }, session.record.inputRevision, actor ?? null);
    session.workspace = { phase: "approval_required", manifestHash: gate.approval.manifestHash, baseSha, pendingApprovalId: request.id };
    await this.setStatus(session, "waiting_approval");
    await this.emitSystem(session, "workspace.approval_required", {
      approvalId: request.id,
      manifestHash: gate.approval.manifestHash,
      project: session.record.project,
      baseSha,
    });
    return false;
  }

  /** Include-Kopie + Setup-Schritte + Services; `false` = Fehler (Event + error-Status). */
  private async runWorkspaceSetup(
    session: LiveSession,
    manifest: WorkspaceManifest,
    manifestHash: string,
    baseSha: string,
    actor: string | null,
    kind: "setup" | "retry",
  ): Promise<boolean> {
    session.workspace = { phase: "preparing", manifestHash, baseSha, pendingApprovalId: null };
    const result = await this.workspaces.runSetup(
      {
        sessionId: session.record.id,
        project: session.record.project,
        manifest,
        manifestHash,
        worktreePath: session.workdir,
        actor,
        emit: (eventKind, payload) => this.emitSystem(session, eventKind, payload),
      },
      kind,
    );
    if (result.ok) {
      session.workspace.phase = "ready";
      return true;
    }
    session.workspace.phase = "failed";
    await this.setStatus(session, "error"); // workspace.failed hat die Runtime bereits emittiert
    return false;
  }

  /** Fail-loud-Hilfe: Phase failed, Status error, ein Event mit Ursache. */
  private async failWorkspace(
    session: LiveSession,
    manifestHash: string | null,
    baseSha: string,
    failure: { step: string; kind: string; exitCode?: number; detail?: string; logBlobRef: string | null },
  ): Promise<void> {
    session.workspace = { phase: "failed", manifestHash: manifestHash ?? "", baseSha, pendingApprovalId: null };
    await this.setStatus(session, "error");
    await this.emitSystem(session, "workspace.failed", { failure, operationId: null, manifestHash });
  }

  /**
   * EPIC-P29: was eine freigegebene workspace.setup-Operation freisetzt —
   * aufgerufen aus ApprovalFlow.applyApproved (Mensch hat entschieden,
   * ADR-0019: läuft höchstens einmal). Zeichnet die Zustimmung auf, setzt
   * das Setup fort und startet den Agenten mit dem Original-StartSpec.
   */
  async resolveWorkspaceSetup(op: PendingOperation, decidedByLabel?: string): Promise<Ack> {
    const session = this.live.get(op.sessionId);
    if (!session) return { ok: false, detail: "session not live" };
    const { approval, startSpec } = op.payload as { approval: WorkspaceSetupApproval; startSpec: SessionSpec };
    this.manifestApprovals.approve({
      project: approval.project,
      manifestHash: approval.manifestHash,
      baseSha: approval.baseSha,
      approvedBy: decidedByLabel ?? "mensch",
    });
    const ok = await this.runWorkspaceSetup(session, approval.manifest, approval.manifestHash, approval.baseSha, decidedByLabel ?? null, "setup");
    if (!ok) return { ok: false, detail: "Workspace-Setup fehlgeschlagen — Schritt/Ursache steht im workspace.failed-Event" };
    session.workspace = { phase: "ready", manifestHash: approval.manifestHash, baseSha: approval.baseSha, pendingApprovalId: null };
    await this.launchAdapter(session, startSpec, false);
    return { ok: true, detail: "Workspace bereit, Agent gestartet" };
  }

  /**
   * EPIC-P29: menschlicher Retry nach `failed`/`needs_attention` — nie
   * automatisch (ADR-0051 §3). Nach Erfolg ist die Session über einen
   * Prompt wieder steuerbar (stopped, nicht working).
   */
  async retryWorkspaceSetup(sessionId: string, actor?: string): Promise<Ack> {
    const session = this.openStopped(sessionId);
    if (!session) return { ok: false, detail: "session not live" };
    if (!session.workspace) {
      const folded = foldWorkspaceState(await this.store.replay(sessionId));
      if (!folded) return { ok: false, detail: "kein Workspace für diese Session" };
      session.workspace = { phase: folded.phase, manifestHash: folded.manifestHash ?? "", baseSha: session.record.worktreeSha ?? "", pendingApprovalId: null };
    }
    const phase = session.workspace.phase;
    if (phase !== "failed" && phase !== "needs_attention") {
      return { ok: false, detail: `Retry nur nach Fehler oder unklarem Zustand (Phase: ${phase})` };
    }
    const baseSha = session.record.worktreeSha ?? session.workspace.baseSha;
    const resolved = await resolveManifest(session.record.project, baseSha);
    if (resolved.status === "none") return { ok: false, detail: "am Basis-SHA existiert kein Manifest mehr" };
    if (resolved.status === "invalid") return { ok: false, detail: `Manifest ungültig: ${resolved.reason}` };
    const gate = gateManifest(resolved, session.record.project, baseSha, this.manifestApprovals);
    if (!gate.ok) {
      return { ok: false, detail: gate.kind === "invalid" ? gate.reason : "der Manifest-Hash braucht erst eine neue Freigabe (neuer Sessionstart)" };
    }
    const ok = await this.runWorkspaceSetup(session, gate.manifest, gate.manifestHash, baseSha, actor ?? null, "retry");
    if (!ok) return { ok: false, detail: "Setup erneut fehlgeschlagen — Ursache im workspace.failed-Event" };
    if (session.record.status === "error") await this.setStatus(session, "stopped"); // steuerbar für den nächsten Prompt
    return { ok: true, detail: "Workspace bereit — Session ist per Prompt wieder steuerbar" };
  }

  /** EPIC-P29: Agenten-Launches sind gesperrt, solange der Workspace nicht bereit ist. */
  private workspaceBlocked(session: LiveSession): string | null {
    if (!session.workspace || session.workspace.phase === "ready") return null;
    return `Workspace ist nicht bereit (${session.workspace.phase}) — erst Freigabe/Retry (EPIC-P29)`;
  }

  /**
   * EPIC-P29 T29.4: Workspace-Status einer Session — Faltung aus den Events
   * (K7) plus Service-Zeilen; `null` ohne Manifest (Migrationsregel). Die
   * Route/Anzeige (T29.6) serviert genau das.
   */
  async workspaceStatus(sessionId: string): Promise<WorkspaceStatus | null> {
    const folded = foldWorkspaceState(await this.store.replay(sessionId));
    if (!folded) return null;
    const session = this.live.get(sessionId);
    const record = this.get(sessionId);
    const services = this.workspaceServices.list(sessionId);
    return {
      sessionId,
      phase: (session?.workspace?.phase ?? folded.phase) as WorkspaceStatus["phase"],
      baseSha: record?.worktreeSha ?? session?.workspace?.baseSha ?? "",
      manifestHash: folded.manifestHash ?? session?.workspace?.manifestHash ?? "",
      services: services.map((row) => ({
        id: row.service_id,
        state: row.state as WorkspaceServiceStatus["state"],
        port: row.port,
        pid: row.pid,
        ...(folded.serviceFailures[row.service_id] ? { failure: folded.serviceFailures[row.service_id] } : {}),
        updatedAt: row.updated_at,
      })),
      ...(folded.failure ? { failure: folded.failure } : {}),
      operationId: this.workspaces.listJournal(sessionId).at(-1)?.id ?? null,
      updatedAt: services.at(-1)?.updated_at ?? "",
    };
  }

  /**
   * EPIC-P29 T29.6: ein registrierter Service (Proxy-Ziel) oder null.
   */
  workspaceService(sessionId: string, serviceId: string): { serviceId: string; state: string; port: number | null; pid: number | null } | null {
    return this.workspaceServices.service(sessionId, serviceId);
  }

  /**
   * EPIC-P29 T29.6: gekappter Log-Schwanz eines Service (K5) — null ohne Zeile.
   */
  async workspaceServiceLogs(sessionId: string, serviceId: string): Promise<{ serviceId: string; tail: string; truncated: boolean; updatedAt: string } | null> {
    return this.workspaceServices.logs(sessionId, serviceId);
  }

  /**
   * Read-only mirror (ADR-0011 Erweiterung): a read-only chat view of an
   * externally observed opencode session. No adapter runs — history and
   * updates come from opencode's own store (same source as the discovery
   * scan). `refreshMirror()` pulls the delta; the observed control mode
   * keeps every steer out.
   */
  private async createMirror(parsed: { adapter: string; project: string; mirrorNativeSessionId?: string | undefined }, actor?: string): Promise<SessionRecord> {
    const nativeId = parsed.mirrorNativeSessionId;
    if (!nativeId) throw new Error("Spiegel ohne native Session-ID");
    const first = readOpenCodeMirrorDelta(this.mirrorDataDir, nativeId, 0);
    if (!first) {
      throw new Error(`Spiegel nicht möglich: keine lesbare opencode-Session „${nativeId}" in ${this.mirrorDataDir}`);
    }
    const now = new Date().toISOString();
    const record: SessionRecord = {
      id: randomUUID(),
      adapter: parsed.adapter,
      project: first.info.project ?? parsed.project,
      worktreeSha: null,
      model: null,
      permissionMode: null,
      status: "idle",
      createdAt: now,
      budgetUsd: null,
      adapterVersion: "0.0.0-mirror",
      lastSeq: 0,
      costUsd: 0,
      updatedAt: now,
      tokensEst: 0,
      metrics: metricsState(emptyMetricCounters()),
      lastActivity: null,
      pinned: false,
      parkReason: null,
      controlMode: "mirror",
      harness: "cli",
      hostId: DEFAULT_HOST_ID,
      nativeSessionId: nativeId,
      resumeVersion: RESUME_SCHEMA_VERSION,
      logOffset: null,
      parentSessionId: null,
      observedAt: now,
      fork: false,
      inputRevision: 0,
      writerClient: null,
      writerLeaseUntil: null,
      archived: false,
      title: first.info.title ?? sessionTitle(nativeId),
      titleSource: "auto",
      persistentWorker: false,
    };
    await this.store.initSession(record.id);
    this.persist(record);
    const session: LiveSession = {
      record,
      adapter: null as unknown as Adapter,
      handle: null,
      abort: new AbortController(),
      subscribers: new Set(),
      workdir: record.project,
      worktreeIsolated: false,
      budgetWarned: false,
    };
    this.live.set(record.id, session);
    await this.emitEvents(session, first.events);
    await this.emitSystem(session, "session.mirror", {
      nativeSessionId: nativeId,
      events: first.events.length,
      actor: actor ?? null,
      read_only: true,
    });
    await this.emitEvents(session, [{ type: "system", summary: "Spiegel steht", payload: { kind: "opencode.mirror_delta", watermark: first.watermark } }]);
    this.logger.info("session mirrored", { sessionId: record.id, nativeSessionId: nativeId });
    return { ...record };
  }

  /** Delta pull for a mirror session: everything opencode wrote since the
   * last watermark becomes chat events (pushed to subscribers live). */
  async refreshMirror(sessionId: string): Promise<void> {
    const record = this.get(sessionId);
    if (!record || record.controlMode !== "mirror" || !record.nativeSessionId) return;
    let session = this.live.get(sessionId);
    if (!session) {
      // after a hub restart the mirror comes back lazily, like stopped runs
      session = {
        record,
        adapter: null as unknown as Adapter,
        handle: null,
        abort: new AbortController(),
        subscribers: new Set(),
        workdir: record.project,
        worktreeIsolated: false,
        budgetWarned: false,
      };
      this.live.set(sessionId, session);
    }
    const tail = await this.store.replay(sessionId);
    const marker = [...tail].reverse().find((e) => (e.payload as { kind?: string }).kind === "opencode.mirror_delta");
    const since = typeof (marker?.payload as { watermark?: unknown })?.watermark === "number" ? (marker!.payload as { watermark: number }).watermark : 0;
    const delta = readOpenCodeMirrorDelta(this.mirrorDataDir, record.nativeSessionId, since);
    if (!delta) {
      await this.emitSystem(session, "session.mirror_lost", { reason: "opencode-Store nicht mehr lesbar" });
      return;
    }
    if (delta.events.length > 0) await this.emitEvents(session, delta.events);
    await this.emitEvents(session, [{ type: "system", summary: "Spiegel aktualisiert", payload: { kind: "opencode.mirror_delta", watermark: delta.watermark } }]);
    const last = tail.at(-1) ?? null;
    record.updatedAt = new Date().toISOString();
    record.lastActivity = last !== null ? activityOf(last) : null;
    this.persist(record);
  }

  /** BUG-0018: a stopped session enters `live` only once someone opens it
   * (tail subscription or steer), never at recovery. The shell is cheap:
   * skill and provider id are read from the log only when the run
   * actually continues (continueStopped). */
  private openStopped(sessionId: string): LiveSession | undefined {
    const existing = this.live.get(sessionId);
    if (existing) return existing;
    const record = this.get(sessionId);
    // "error" too: a dead run (hub restart, crashed worker) must stay
    // continuable — the user's way back into a session is a new prompt.
    if (!record || (record.status !== "stopped" && record.status !== "error" && record.status !== "interrupted")) return undefined;
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

  /** The worktree of an isolated session can be gone (EPIC-P14: archiving
   * frees clean ones). Its path is fixed per session, so bringing it back
   * keeps `ctx.workdir` valid; the base moves to the project's current HEAD,
   * which loses nothing because only clean worktrees are ever removed.
   * EPIC-P29: returns whether the worktree was (re-)created — a fresh
   * worktree lacks the workspace's declared files and steps. */
  private async ensureWorkdir(session: LiveSession): Promise<boolean> {
    if (!this.worktrees || existsSync(session.workdir)) return false;
    let recreated = false;
    try {
      const created = await this.worktrees.create(session.record.id, session.record.project);
      if (created) {
        session.workdir = created.path;
        session.worktreeIsolated = true;
        session.record.worktreeSha = created.baseSha;
        recreated = true;
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
    return recreated;
  }

  /**
   * EPIC-P29: Setup nach Worktree-Neuanlage — nur mit bereits genehmigtem
   * Hash am aktuellen Basis-SHA. Ein geändertes Manifest braucht einen neuen
   * Start (neue Zustimmung), nie einen Strohmann-Retry. Läuft nie im
   * Projektordner des Nutzers (dann gilt der Workspace als nicht
   * reproduzierbar).
   */
  private async reprepareWorkspace(session: LiveSession, actor?: string): Promise<Ack> {
    if (!session.worktreeIsolated) return { ok: false, detail: "Worktree nicht mehr vorhanden — Workspace nicht reproduzierbar" };
    const baseSha = session.record.worktreeSha ?? session.workspace?.baseSha ?? null;
    const resolved = await resolveManifest(session.record.project, baseSha);
    if (resolved.status === "none") return { ok: true }; // kein Manifest mehr: alter Pfad
    if (resolved.status === "invalid") return { ok: false, detail: `Manifest ungültig: ${resolved.reason}` };
    const gate = gateManifest(resolved, session.record.project, baseSha, this.manifestApprovals);
    if (!gate.ok) {
      return { ok: false, detail: gate.kind === "invalid" ? gate.reason : "geändertes Manifest braucht eine neue Freigabe — bitte neuen Start" };
    }
    const ok = await this.runWorkspaceSetup(session, gate.manifest, gate.manifestHash, baseSha ?? "", actor ?? null, "retry");
    return ok ? { ok: true, detail: "Workspace erneut vorbereitet" } : { ok: false, detail: "Setup nach Worktree-Neuanlage fehlgeschlagen" };
  }

  /** A stopped run keeps its provider session id. A new prompt spawns the CLI again. */
  private async continueStopped(
    session: LiveSession,
    input: Extract<SteerInput, { kind: "prompt" }>,
    actor?: string,
  ): Promise<Ack> {
    session.abort.abort();
    session.abort = new AbortController();
    session.activeWorkers = 0;
    session.persistentWorker = false;
    const events = await this.store.replay(session.record.id);
    // EPIC-P29: der Workspace-Zustand einer wiedergeöffneten Session kommt
    // aus den Events (K7-Faltung) — nie aus Erinnerung.
    if (session.workspace === undefined) {
      const folded = foldWorkspaceState(events);
      if (folded) {
        session.workspace = { phase: folded.phase, manifestHash: folded.manifestHash ?? "", baseSha: session.record.worktreeSha ?? "", pendingApprovalId: null };
      }
    }
    const wsBlocked = this.workspaceBlocked(session);
    if (wsBlocked) return { ok: false, detail: wsBlocked };
    if (!session.skillName || !session.record.nativeSessionId) {
      if (!session.skillName) {
        const skill = skillNameFromEvents(events);
        if (skill) session.skillName = skill;
      }
      if (!session.record.nativeSessionId) {
        const native = nativeIdFromEvents(events) ?? (await nativeIdFromWorkerLog(this.store.directory(), session.record.id));
        if (native) session.record.nativeSessionId = native;
      }
    }
    const recreated = await this.ensureWorkdir(session);
    // EPIC-P29: ein frisch wiederangelegter Worktree hat die deklarierten
    // Dateien/Schritte nicht — Setup (gleicher, bereits genehmigter Hash)
    // läuft erneut, bevor der Agent etwas sieht.
    if (recreated && session.workspace) {
      const reprepared = await this.reprepareWorkspace(session, actor);
      if (!reprepared.ok) return reprepared;
    }
    const converted = this.withAttachments(session, { text: await this.promptWithSkill(session, input.text), attachments: input.attachments });
    const text = converted.text;
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
          ...(converted.attachments ? { attachments: converted.attachments } : {}),
          ...(session.record.model ? { model: session.record.model } : {}),
          args: {
            ...(session.record.permissionMode ? { permissionMode: session.record.permissionMode } : {}),
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

  /** ADR-0044: serialize native resume with every other session input. */
  resume(sessionId: string, actor?: string): Promise<Ack> {
    const previous = this.steerQueue.get(sessionId) ?? Promise.resolve();
    const run = previous.then(() => this.resumeNow(sessionId, actor));
    const settled = run.then(() => undefined, () => undefined);
    this.steerQueue.set(sessionId, settled);
    void settled.then(() => { if (this.steerQueue.get(sessionId) === settled) this.steerQueue.delete(sessionId); });
    return run;
  }

  private async resumeNow(sessionId: string, actor?: string): Promise<Ack> {
    if (actorKind(actor) !== "human" && actorKind(actor) !== "fleet") return { ok: false, detail: "Nur Menschen dürfen unterbrochene Sessions fortsetzen." };
    await this.interruption.settled(sessionId);
    const session = this.openStopped(sessionId);
    if (!session || session.record.status !== "interrupted") return { ok: false, detail: "Session ist nicht unterbrochen." };
    const declaration = this.registry.get(session.record.adapter)?.capabilities.resume;
    if (!declaration?.hub || declaration.ref !== "native") {
      const detail = "Dieser Adapter kann nicht nativ fortsetzen. Neue Nachricht mit Kontext senden oder archivieren.";
      await this.emitSystem(session, "session.resume_unsupported", { detail });
      return { ok: false, detail };
    }
    const native = session.record.nativeSessionId;
    if (!native) return { ok: false, detail: "Provider-Session unbekannt — natives Fortsetzen nicht möglich." };
    session.abort.abort();
    session.abort = new AbortController();
    session.activeWorkers = 0;
    session.persistentWorker = false;
    const recreated = await this.ensureWorkdir(session);
    // EPIC-P29: natives Fortsetzen braucht ebenfalls einen vorbereiteten
    // Workspace — bei Neuanlage des Worktree läuft das genehmigte Setup
    // erneut, ein verändertes Manifest blockiert (neue Freigabe = neuer Start).
    if (session.workspace) {
      const wsBlocked = this.workspaceBlocked(session);
      if (wsBlocked) return { ok: false, detail: wsBlocked };
      if (recreated) {
        const reprepared = await this.reprepareWorkspace(session, actor);
        if (!reprepared.ok) return reprepared;
      }
    }
    await this.setStatus(session, "working");
    await this.emitSystem(session, "session.resumed", { actor: actor ?? null, nativeSessionId: native });
    try {
      session.handle = await session.adapter.start({
        adapter: session.record.adapter, project: session.record.project,
        ...(session.record.model ? { model: session.record.model } : {}),
        args: { resumeSessionId: native, ...(session.record.permissionMode ? { permissionMode: session.record.permissionMode } : {}) },
      }, this.makeContext(session));
      session.record.controlMode = "controllable";
      this.persist(session.record);
      return { ok: true };
    } catch (err) {
      await this.setStatus(session, "error");
      const detail = err instanceof Error ? err.message : String(err);
      await this.emitSystem(session, "session.resume_failed", { detail });
      await this.emitSystem(session, "session.turn_end", { code: null, reason: "error" });
      return { ok: false, detail };
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
    // A mirror is a read-only view (ADR-0011 Erweiterung): nothing may be
    // steered, stopped or parked into opencode's session — loudly refused.
    if (input.kind === "prompt" || input.kind === "resume") await this.interruption.settled(sessionId);
    const mirrorRecord = this.get(sessionId);
    if (mirrorRecord?.controlMode === "mirror") {
      return { ok: false, detail: "Spiegel-Session ist nur lesbar — zum Weiterarbeiten übernehmen" };
    }
    const session = this.openStopped(sessionId);
    if (!session) {
      const record = this.get(sessionId);
      if (record?.status === "stopped") return { ok: false, detail: `adapter "${record.adapter}" not registered` };
      return { ok: false, detail: "session not live" };
    }
    // EPIC-P29 (AC-P29-3): kein Prompt erreicht einen Agenten, dessen
    // Workspace nicht bereit ist — weder wartender noch fehlerhafter.
    const wsBlocked = this.workspaceBlocked(session);
    if (wsBlocked) return { ok: false, detail: wsBlocked };
    if (session.record.status === "interrupted") {
      if (actorKind(actor) !== "human" && actorKind(actor) !== "fleet") return { ok: false, detail: "Nur Menschen dürfen unterbrochene Sessions fortsetzen." };
      if (input.kind === "resume") return this.resumeNow(sessionId, actor);
    }
    if (!session.handle && input.kind !== "prompt" && input.kind !== "configure") return { ok: false, detail: "session not live" };
    if (meta?.inputId && this.hasSeenInput(sessionId, meta.inputId)) {
      return { ok: true, detail: "duplicate input ignored" };
    }
    // T17.4: the first attempt may still be running after its wait timed
    // out — its outcome is unknown, so the same input id must not be
    // submitted twice (AC-P17-3).
    if (meta?.inputId && this.inputInFlight(sessionId, meta.inputId)) {
      return { ok: false, detail: "input in flight — outcome of the earlier attempt is unknown" };
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
    if (input.kind === "park") {
      // EPIC-P15 T15.3: the phone's Pause. Reaches the adapter AND sets the status — a bare adapter
      // steer used to kill the process and leave the session "working".
      if (session.record.status === "parked") return { ok: true };
      const done = await this.park(sessionId, actor);
      if (done.ok) await this.commitSteer(session, meta, foreignWriter, actor);
      return done;
    }
    if (input.kind === "configure") {
      const done = await this.configure(session, input, actor);
      if (done.ok) await this.commitSteer(session, meta, foreignWriter, actor);
      return done;
    }
    // EPIC-P15 T15.3: "Vormerken" — the prompt waits for the running turn instead of starting a second process.
    if (input.kind === "prompt" && meta?.queue && !meta.fromQueue && session.handle && ["starting", "working", "waiting_approval"].includes(session.record.status)) {
      const item = this.queue.add(sessionId, input.text, input.attachments, actor ?? null);
      await this.emitSystem(session, "session.queued", { queueId: item.id, position: this.queue.count(sessionId), actor: actor ?? null });
      await this.commitSteer(session, meta, foreignWriter, actor);
      return { ok: true, detail: "queued" };
    }
    let delivered = input;
    // BUG-0100: Ein Zug, dessen letzter Worker beendet ist, während die
    // Abschluss-Klassifizierung (250 ms) noch läuft, würde einen Prompt an
    // das tote Handle verlieren (CI-Lauf 3038014959). Erst den abgeschnittenen
    // Zug sauber abschließen (turn_end), dann normal weitermachen.
    // workerExitPending unterscheidet den toten Zwischenzustand von
    // in-proc-Adaptern, die nie einen Worker-Prozess haben.
    if (input.kind === "prompt" && session.workerExitPending && (session.record.status === "working" || session.record.status === "starting")) {
      await this.interruption.interrupt(session, "worker_exit");
      session.workerExitPending = false;
    }
    const reopening = input.kind === "prompt" && (session.record.status === "stopped" || !session.handle);
    if (input.kind === "prompt" && session.skillName && !reopening) {
      delivered = { ...input, text: await this.promptWithSkill(session, input.text) };
    }
    const gated = await this.flow.gateSteer(session, input, delivered, actor);
    if (gated) return gated;
    if (input.kind === "prompt") await this.emitPrompt(session, input.text, actor, input.attachments);
    if (delivered.kind === "prompt") delivered = this.withAttachments(session, delivered);
    if (reopening && delivered.kind === "prompt") {
      // BUG-0016: the reopen is a steer like any other — without the
      // commit, a retried input id started the provider a second time.
      // T17.4: same hard wait as every submission (see submitAndWait).
      const reopened = await this.submitAndWait(
        session,
        meta,
        foreignWriter,
        actor,
        "prompt",
        () => this.continueStopped(session, delivered, actor),
      );
      if (reopened.ok) await this.commitSteer(session, meta, foreignWriter, actor);
      return reopened;
    }
    if (delivered.kind === "prompt") await this.ensureWorkdir(session);
    const ack = await this.submitAndWait(
      session,
      meta,
      foreignWriter,
      actor,
      input.kind,
      () => session.adapter.steer(session.handle!, delivered, this.makeContext(session)),
    );
    // EPIC-P15 T15.3: a prompt after a manual Pause starts the next turn — the status follows.
    // (Budget and daily-cap parks keep their own rules.)
    if (ack.ok && delivered.kind === "prompt" && session.record.status === "parked" && session.record.parkReason === "manual") {
      session.record.parkReason = null;
      await this.setStatus(session, "working");
    }
    // BUG found via T2.8's own audit test: emitSystem() builds
    // `{ kind, ...payload }`, where `kind` is this call's own event-kind
    // string ("session.steer") — a payload field ALSO named `kind` (the
    // steer input's kind, e.g. "resume") silently overwrote it, so every
    // non-"prompt" steer's audit event had payload.kind === "resume"/
    // "park" instead of "session.steer" ever since T2.4 introduced this
    // call. Named `steerKind` here to never collide again.
    await this.emitSystem(session, "session.steer", { steerKind: input.kind, ok: ack.ok, actor: actor ?? null, ...(ack.ok ? {} : { detail: ack.detail ?? null }) });
    if (ack.ok) await this.commitSteer(session, meta, foreignWriter, actor);
    return ack;
  }

  /**
   * ADR-0033: model and permission mode of a session. A live adapter applies it
   * at the latest on the next turn; a stopped session passes it on when it is
   * continued. The change is an event, so recovery finds it again (K7).
   */
  private async configure(session: LiveSession, input: Extract<SteerInput, { kind: "configure" }>, actor?: string): Promise<Ack> {
    if (session.handle && session.record.status !== "stopped") {
      const ack = await session.adapter.steer(session.handle, input, this.makeContext(session));
      if (!ack.ok) return ack;
    }
    if (input.model !== undefined) session.record.model = input.model;
    if (input.permissionMode !== undefined) session.record.permissionMode = input.permissionMode;
    session.record.updatedAt = new Date().toISOString();
    this.persist(session.record);
    await this.emitSystem(session, "session.configured", {
      model: session.record.model,
      permissionMode: session.record.permissionMode,
      actor: actor ?? null,
    });
    return { ok: true };
  }

  /** The user's own input as a chat message — as typed, without the skill
   * chain the hub puts in front for the provider. The hub is the one source
   * for these; adapters no longer echo prompts as `user` events. */
  private async emitPrompt(session: LiveSession, text: string, actor?: string, attachments?: readonly PromptAttachment[]): Promise<void> {
    // A session that had no start prompt takes its first reply as title.
    if (!session.record.title) session.record.title = sessionTitle(text);
    session.titlePrompt ??= text;
    // T7.10: references only (K5) — never the bytes or the extracted text.
    const refs = attachments?.map((a) => ({ id: a.id, name: a.name, mimeType: a.mimeType, kind: a.kind, bytes: a.bytes, method: a.method }));
    await this.emitEvents(session, [
      { type: "user", summary: text.slice(0, 200) || `${refs?.length ?? 0} Anhang/Anhänge`, payload: { kind: "session.prompt", text, actor: actor ?? null, ...(refs && refs.length > 0 ? { attachments: refs } : {}) } },
    ]);
  }

  /**
   * T7.10 (ADR-0022): a harness that takes files or images itself gets the
   * attachments; any other gets their text inside the prompt.
   */
  private withAttachments<T extends { text: string; attachments?: PromptAttachment[] | undefined }>(session: LiveSession, input: T): T {
    if (!input.attachments || input.attachments.length === 0) return input;
    const f = this.registry.get(session.record.adapter)?.capabilities.features;
    if (f?.images || f?.files) return input;
    const { attachments, ...rest } = input;
    return { ...rest, text: promptWithAttachments(input.text, attachments) } as T;
  }

  private readonly notificationListeners: ((n: HubNotification) => unknown)[] = [];

  /** T8.3: hear about every stored notification (e.g. Web Push). */
  onNotification(listener: (n: HubNotification) => unknown): void {
    this.notificationListeners.push(listener);
  }

  /** ADR-0015: cross-session notifications, persisted so every device and a
   * restarted hub show the same list. */
  private recordNotifications(session: LiveSession, events: readonly NormalizedEvent[]): void {
    for (const event of events) {
      const kind = (event.payload as { kind?: unknown }).kind;
      if (kind === "provider.error") this.lastProviderError.set(session.record.id, Date.now());
      // The interruption already notified the person; adapter.down is supporting evidence.
      if (kind === "adapter.down" && session.record.status === "interrupted") continue;
      const draft = notificationFor(event, {
        adapter: session.record.adapter,
        project: session.record.project,
        recentProviderError: Date.now() - (this.lastProviderError.get(session.record.id) ?? 0) < 30_000 && kind !== "provider.error",
      });
      if (!draft) continue;
      const res = this.db
        .prepare("INSERT INTO notifications (session_id, level, title, detail, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(session.record.id, draft.level, draft.title, draft.detail, draft.kind, event.ts);
      // T8.3: push and other listeners — after it is stored, never blocking.
      const stored: HubNotification = { id: Number(res.lastInsertRowid), sessionId: session.record.id, level: draft.level, title: draft.title, detail: draft.detail, kind: draft.kind, createdAt: event.ts };
      for (const listener of this.notificationListeners) {
        void Promise.resolve()
          .then(() => listener(stored))
          .catch((err) => this.logger.warn("notification listener failed", { err: String(err) }));
      }
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
    const message = `AncientVoid: ${record.title ?? `Session ${sessionId.slice(0, 8)}`}`;
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

  /**
   * EPIC-P17 T17.4: every prompt submission waits at most `steerWaitMs`.
   * A timeout answers "outcome unknown" (visible as session.steer_timeout)
   * and NEVER resubmits: the input id stays reserved for the still-running
   * attempt, and a late success still commits it — a retry with the same
   * id then dedups against the store like any delivered input.
   */
  private async submitAndWait(
    session: LiveSession,
    meta: SteerMeta | undefined,
    foreignWriter: string | null,
    actor: string | undefined,
    steerKind: SteerInput["kind"],
    submit: () => Promise<Ack>,
  ): Promise<Ack> {
    const sessionId = session.record.id;
    const inputId = meta?.inputId;
    if (inputId) {
      const ids = this.inFlightInputs.get(sessionId) ?? new Set<string>();
      ids.add(inputId);
      this.inFlightInputs.set(sessionId, ids);
    }
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;
    const expired = new Promise<{ expired: true }>((resolve) => {
      timer = setTimeout(() => resolve({ expired: true }), this.steerWaitMs);
    });
    const attempt = submit();
    const outcome = await Promise.race([attempt.then((ack) => ({ ack })), expired]);
    clearTimeout(timer);
    if ("ack" in outcome) {
      this.releaseInFlight(sessionId, inputId);
      return outcome.ack;
    }
    // The wait is over, the attempt is not — its late result still counts.
    void attempt
      .then(async (ack) => {
        if (ack.ok) await this.commitSteer(session, meta, foreignWriter, actor).catch(() => undefined);
      })
      .catch(() => undefined)
      .finally(() => this.releaseInFlight(sessionId, inputId));
    await this.emitSystem(session, "session.steer_timeout", {
      steerKind,
      inputId: inputId ?? null,
      waitedMs: this.steerWaitMs,
      detail: STEER_TIMEOUT_DETAIL,
    });
    return { ok: false, detail: STEER_TIMEOUT_DETAIL };
  }

  /** T17.4: the attempt settled — free its input id for retries. */
  private releaseInFlight(sessionId: string, inputId: string | undefined): void {
    if (!inputId) return;
    const ids = this.inFlightInputs.get(sessionId);
    if (!ids) return;
    ids.delete(inputId);
    if (ids.size === 0) this.inFlightInputs.delete(sessionId);
  }

  private inputInFlight(sessionId: string, inputId: string): boolean {
    return this.inFlightInputs.get(sessionId)?.has(inputId) ?? false;
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

  /**
   * EPIC-P29 / ADR-0051 §2: die Manifest-Freigabe läuft über die echte,
   * immer vorhandene Queue — der Server verdrahtet sie unabhängig von
   * `requireStepApprovals` (gleiche Figur wie enableToolPermissions).
   */
  enableWorkspaceApprovals(approvals: ApprovalService): void {
    this.workspaceApprovals = approvals;
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
    this.queue.clear(sessionId); // Stop heißt: nichts mehr senden, auch nichts Vorgemerktes
    session.abort.abort();
    try {
      if (session.handle) await session.adapter.stop(session.handle, this.makeContext(session));
    } finally {
      // EPIC-P29 T29.4: eigene Services zuerst beenden — nur nachgewiesen
      // eigene Prozesse (ADR-0051 §4); ihr cwd liegt im Worktree und würde
      // jede saubere Entsorgung als "in Benutzung" blocken.
      await this.workspaceServices
        .stopAll(sessionId, (kind, payload) => this.emitSystem(session, kind, payload))
        .catch((err) => this.logger.warn("service stop failed", { sessionId, err: err instanceof Error ? err.message : String(err) }));
      // EPIC-P29 T29.5: genehmigter Teardown läuft hier, solange der
      // Worktree existiert — Scheitern hält ihn fest (workspace.cleanup_failed).
      const teardown = await this.teardownWorkspaceOnce(sessionId, actor).catch(() => "failed" as const);
      // T2.1: clean up the isolated worktree once the adapter is done with
      // it — but only a clean one. BUG-0027: `remove --force` + `branch -D`
      // destroyed every uncommitted file and commit an agent had made.
      // A worktree with work stays, and "Weiter" continues in it.
      // Removal failures are a disk-hygiene problem to surface, not a
      // reason to leave the session stuck in "stopping".
      if (session.worktreeIsolated && this.worktrees) {
        try {
          if (teardown === "failed") {
            await this.emitSystem(session, "session.worktree_kept", {
              path: this.worktrees.pathFor(session.record.id),
              branch: this.worktrees.branchFor(session.record.id),
              reason: "teardown",
            });
          } else if (await this.worktrees.hasWork(session.record.id, session.record.worktreeSha, session.record.project)) {
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

  /**
   * Delete a session for good — events, snapshot, worktree and row. Only
   * for runs that are not live: a working session has to be stopped first
   * (its worker and worktree still belong to it). Uncommitted agent work
   * in a kept worktree goes with it, so the PWA asks before calling this.
   */
  async delete(sessionId: string): Promise<Ack> {
    const record = this.get(sessionId);
    if (!record) return { ok: false, detail: "session not found" };
    if (this.live.has(sessionId) && record.status !== "error" && record.status !== "stopped" && record.status !== "parked") {
      return { ok: false, detail: "Die Session läuft noch — erst stoppen, dann löschen." };
    }
    const live = this.live.get(sessionId);
    if (live) {
      live.abort.abort();
      this.live.delete(sessionId);
    }
    // EPIC-P29: Services gehören zur Session — auch beim Löschen werden nur
    // nachweisbar eigene Prozesse beendet, dann erst der Worktree entfernt.
    await this.workspaceServices
      .stopAll(sessionId, (kind, payload) => (live ? this.emitSystem(live, kind, payload) : Promise.resolve()))
      .catch((err) => this.logger.warn("service stop on delete failed", { sessionId, err: err instanceof Error ? err.message : String(err) }));
    if (record.worktreeSha !== null && this.worktrees) {
      try {
        if (existsSync(this.worktrees.pathFor(sessionId))) await this.worktrees.remove(sessionId, record.project);
      } catch (err) {
        this.logger.warn("worktree removal on delete failed", { sessionId, err: err instanceof Error ? err.message : String(err) });
      }
    }
    await this.store.destroySession(sessionId);
    this.queue.clear(sessionId);
    // T17.4: no attempt can settle for a deleted session — its reserved
    // input ids would leak into the map forever.
    this.inFlightInputs.delete(sessionId);
    // EPIC-P29: Workspace-Journal und -Servicezeilen gehören zur Session —
    // sie gehen mit ihr, sonst wachsen verwaiste Zeilen.
    this.db.prepare("DELETE FROM workspace_services WHERE session_id = ?").run(sessionId);
    this.db.prepare("DELETE FROM workspace_operations WHERE session_id = ?").run(sessionId);
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
    this.metrics?.inc("sessions_deleted");
    this.logger.info("session deleted", { sessionId, adapter: record.adapter });
    return { ok: true };
  }

  /** ADR-0009: fire-and-forget, best-effort. A throwing/rejecting sink
   * must never affect the (already-returned) stop() result — errors are
   * caught per-sink and surfaced as a real system event instead of a
   * silent drop (AGENTS.md Regel 6 "fail loud"). */
  private dispatchDigest(session: LiveSession): void {
    if (this.reportingSinks.length === 0) return;
    // A resume may begin while the journal flushes; the digest belongs to this boundary.
    const record = { ...session.record };
    void (async () => {
      await this.store.flush(record.id);
      const events = (await this.store.replay(record.id)).filter(e => e.seq <= record.lastSeq);
      const summary = buildSessionSummary(record, events);
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
    session.parkGeneration = (session.parkGeneration ?? 0) + 1;
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
  /**
   * EPIC-P21 T21.2: the proposal for handing a session to another provider — the text the next one
   * starts from, and why (the provider.error of the current turn, if there is one).
   */
  async handoverDraft(sessionId: string): Promise<{ prompt: string; adapter: string; model: string | null; reason: { category: string; title: string; detail: string } | null }> {
    const record = this.live.get(sessionId)?.record ?? this.list().find((r) => r.id === sessionId);
    if (!record) throw new Error("unknown session");
    const events = await this.store.replay(sessionId);
    let reason: { category: string; title: string; detail: string } | null = null;
    for (let i = events.length - 1; i >= 0 && !reason; i--) {
      const p = events[i]!.payload as { kind?: unknown; category?: unknown; title?: unknown; detail?: unknown };
      if (p.kind === "session.prompt") break;
      if (p.kind === "provider.error") reason = { category: String(p.category ?? "unknown"), title: String(p.title ?? events[i]!.summary), detail: String(p.detail ?? "") };
    }
    return { prompt: buildHandoverPrompt(events, { adapter: record.adapter, model: record.model, ...(reason ? { reason } : {}) }), adapter: record.adapter, model: record.model, reason };
  }

  /** Starts a new session at another adapter/model with the (edited) handover text; both sides record the link. */
  async handover(sessionId: string, input: { adapter: string; model?: string | undefined; prompt: string }, actor?: string): Promise<SessionRecord> {
    const source = this.live.get(sessionId)?.record ?? this.list().find((r) => r.id === sessionId);
    if (!source) throw new Error("unknown session");
    if (input.prompt.length === 0 || input.prompt.length > HANDOVER_PROMPT_MAX) throw new Error(`handover prompt must be 1–${HANDOVER_PROMPT_MAX} characters`);
    const created = await this.create({ adapter: input.adapter, project: source.project, prompt: input.prompt, ...(input.model ? { model: input.model } : {}) }, actor);
    const from = this.live.get(sessionId);
    const to = this.live.get(created.id);
    if (from) await this.emitEvents(from, [{ type: "system", summary: `Übergeben an ${created.adapter}${created.model ? ` (${created.model})` : ""}`, payload: { kind: "session.handover_out", toSessionId: created.id, adapter: created.adapter, model: created.model } }]);
    if (to) await this.emitEvents(to, [{ type: "system", summary: `Übernommen von ${source.adapter}${source.model ? ` (${source.model})` : ""}`, payload: { kind: "session.handover_in", fromSessionId: sessionId, adapter: source.adapter, model: source.model } }]);
    return created;
  }

  /** Rebuilds one session's turn measurements from its event stream (idempotent). */
  private async recordTurnMetrics(sessionId: string): Promise<void> {
    const record = this.live.get(sessionId)?.record ?? this.list().find((r) => r.id === sessionId);
    if (!record) return;
    const turns = deriveTurnMetrics(await this.store.replay(sessionId), { sessionId, adapter: record.adapter, model: record.model });
    this.turnMetricStore.replaceSession(sessionId, turns);
  }

  /** K7 recovery path for turn measurements: sessions without rows are rebuilt from JSONL, one at a time. */
  async backfillTurnMetrics(): Promise<number> {
    let rebuilt = 0;
    for (const record of this.list()) {
      if (this.turnMetricStore.hasSession(record.id)) continue;
      await this.recordTurnMetrics(record.id);
      if (this.turnMetricStore.hasSession(record.id)) rebuilt++;
    }
    return rebuilt;
  }

  /** Typical duration of a turn for this session's adapter/model — null for an unknown session. */
  runEstimate(sessionId: string): RunEstimate | null {
    const record = this.live.get(sessionId)?.record ?? this.list().find((r) => r.id === sessionId);
    return record ? this.turnMetricStore.estimate(record.adapter, record.model, sessionId) : null;
  }

  turnMetrics(sessionId: string): TurnMetric[] {
    return this.turnMetricStore.listBySession(sessionId);
  }

  turnMetricsSummary(): ReturnType<TurnMetricStore["summary"]> {
    return this.turnMetricStore.summary();
  }

  async recoverAll(): Promise<{ recovered: number; failed: number; reaped: string[]; uncontrolled: number }> {
    const t0 = performance.now();
    const persisted = this.list();
    const keepWorkers: string[] = [];
    let recovered = 0;
    let failed = 0;
    let uncontrolled = 0;

    type Outcome = "recovered" | "failed" | "uncontrolled";
    const recoverOne = async (record: SessionRecord): Promise<Outcome> => {
      if (record.status === "stopped") {
        // Loaded when opened (openStopped), so recovery time does not grow
        // with the history of finished runs.
        return "recovered";
      }
      if (record.controlMode === "mirror") {
        // A mirror is a read-only view with no adapter of its own — nothing
        // to recover, it refreshes from opencode's store when opened.
        return "recovered";
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
      // EPIC-P29 (K7, ADR-0051 §5): Workspace-Phase aus den Events falten
      // und hängengebliebene Operationen als unklar markieren — genau ein
      // needs_attention-Event je Operation, kein automatischer Re-Run.
      const foldedWorkspace = foldWorkspaceState(events);
      if (foldedWorkspace) {
        session.workspace = { phase: foldedWorkspace.phase, manifestHash: foldedWorkspace.manifestHash ?? "", baseSha: record.worktreeSha ?? "", pendingApprovalId: null };
      }
      const unclear = await this.workspaces.reconcileAfterCrash(record.id, (kind, payload) => this.emitSystem(session, kind, payload));
      if (unclear > 0 && session.workspace) session.workspace.phase = "needs_attention";
      // EPIC-P29 T29.4: Services als `probing` markieren und asynchron
      // adoptieren/prüfen — blockiert den Restore nicht (ADR-0051 §5, K7).
      if (this.workspaceServices.list(record.id).length > 0) {
        this.workspaceServices.reconcile(record.id, (kind, payload) => this.emitSystem(session, kind, payload));
      }
      if (foldedWorkspace && record.status === "waiting_approval") {
        // EPIC-P29: eine auf Manifest-Freigabe wartende Session hat nichts
        // zu adoptieren — Journal/Phase wiederherstellen, dem Menschen
        // steuerbar lassen (kein "observed", kein Auto-Re-Run).
        await this.emitSystem(session, "session.recovered", { events: events.length, lastSeq, controllable: true });
        return "recovered";
      }
      if (record.status === "interrupted") {
        await this.interruption.repair(session);
        return "recovered";
      }
      // ADR-0050/BUG-0092: Bei beendeten Zügen ohne persistenten Adapter-
      // Prozess (idle, geparkt) lief vor dem Crash nichts, das adoptiert
      // werden könnte — adapter.recover() hätte dem Adapter einen NEUEN
      // Lauf gestartet. Journal/Status wiederherstellen, steuerbar lassen;
      // ein neuer Prompt startet normal über steer.
      if (!record.persistentWorker && (record.status === "idle" || record.status === "parked")) {
        await this.emitSystem(session, "session.recovered", { events: events.length, lastSeq, controllable: true });
        return "recovered";
      }

      if (!registered) {
        await this.setStatus(session, "error");
        await this.emitSystem(session, "session.recovery_failed", {
          reason: `adapter "${record.adapter}" not registered`,
        });
        return "failed";
      }
      try {
        if (registered.adapter.recover) {
          const handle = await registered.adapter.recover(
            record.id,
            lastSeq,
            this.makeContext(session),
          );
          session.handle = handle;
        }
        if ((record.status === "working" || record.status === "starting") && (session.adopted === false || !session.handle)) {
          await this.interruption.interrupt(session, "hub_restart");
        }
        if (session.handle) keepWorkers.push(record.id);
        if (!session.handle) {
          session.record.controlMode = "observed";
          this.persist(session.record);
          await this.emitSystem(session, "session.recovered", {
            events: events.length,
            lastSeq,
            controllable: false,
            // 2026-10-25: whether the session was mid-turn — only then is
            // "nur noch lesbar" a real loss worth a bell warning.
            wasWorking: session.record.status === "working",
          });
          return "uncontrolled";
        }
        await this.emitSystem(session, "session.recovered", {
          events: events.length,
          lastSeq,
          controllable: true,
        });
        return "recovered";
      } catch (err) {
        await this.setStatus(session, "error");
        await this.emitSystem(session, "session.recovery_failed", {
          reason: err instanceof Error ? err.message : String(err),
        });
        return "failed";
      }
    };
    // BUG-0050: sessions are independent and `adapter.recover` mostly waits for a process or a
    // handshake — one after the other that was 12–14 s for 25 sessions (K7: < 3 s).
    const timings: { id: string; adapter: string; ms: number }[] = [];
    const outcomes = await mapLimit(persisted, RECOVERY_CONCURRENCY, async (record) => {
      const started = performance.now();
      const outcome = await recoverOne(record);
      timings.push({ id: record.id, adapter: record.adapter, ms: Math.round(performance.now() - started) });
      return outcome;
    });
    for (const outcome of outcomes) {
      if (outcome === "recovered") recovered++;
      else if (outcome === "failed") failed++;
      else uncontrolled++;
    }
    const sessionsMs = Math.round(performance.now() - t0);

    const tailStart = performance.now();
    await this.flow.reconcile();
    const reconcileMs = Math.round(performance.now() - tailStart);
    for (const live of this.live.values()) await this.healWaitingApproval(live, true);
    const healMs = Math.round(performance.now() - tailStart) - reconcileMs;
    for (const sessionId of this.queue.sessionsWithEntries()) this.scheduleDrain(sessionId);
    const reapStart = performance.now();
    const reaped = await this.runner.reapOrphans(keepWorkers).catch(() => []);
    const reapMs = Math.round(performance.now() - reapStart);
    const elapsed = performance.now() - t0;
    this.metrics?.gauge("recovery_ms", elapsed);
    if (elapsed > this.recoveryBudgetMs) {
      // Where the time goes: without this a slow start is only "12 s", never "which adapter".
      const perAdapter: Record<string, { sessions: number; totalMs: number; maxMs: number }> = {};
      for (const t of timings) {
        const entry = (perAdapter[t.adapter] ??= { sessions: 0, totalMs: 0, maxMs: 0 });
        entry.sessions++;
        entry.totalMs += t.ms;
        entry.maxMs = Math.max(entry.maxMs, t.ms);
      }
      const slowest = [...timings].sort((a, b) => b.ms - a.ms).slice(0, 5).map((t) => ({ session: t.id.slice(0, 8), adapter: t.adapter, ms: t.ms }));
      this.logger.warn("recovery exceeded K7 budget", { elapsedMs: Math.round(elapsed), budgetMs: this.recoveryBudgetMs });
      this.logger.info("recovery detail", { sessionsMs, reconcileMs, healMs, reapMs, perAdapter, slowest });
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
    const signal = session.abort.signal;
    return {
      sessionId: session.record.id,
      signal,
      workdir: session.workdir,
      log: (level, msg, extra) => {
        const logger = this.logger.child({
          adapter: session.record.adapter,
          sessionId: session.record.id,
        });
        logger[level](msg, extra);
      },
      emit: (event: EmittedEvent) => {
        if (signal.aborted) return;
        void this.emitEvents(session, [event]).catch((err) => this.handleEmitFailure(session, event, err));
      },
      blob: async (data: string | Uint8Array): Promise<BlobRef> => {
        return this.store.writeBlob(session.record.id, data);
      },
      spawnWorker: async (cmd, opts) => {
        const proc = await this.runner.spawn({
          name: session.record.id,
          // T17.5/ADR-0037: explicit marker — identity after a restart
          // comes from this, not from the (overridable) name.
          sessionId: session.record.id,
          cwd: session.workdir,
          cmd,
          ...(opts?.env !== undefined ? { env: opts.env } : {}),
          ...(opts?.cols !== undefined ? { cols: opts.cols } : {}),
          ...(opts?.rows !== undefined ? { rows: opts.rows } : {}),
          ...(opts?.stdin !== undefined ? { stdin: opts.stdin } : {}),
        });
        // ADR-0013 Nachtrag: a persistent agent is not a turn — the adapter
        // reports turns through ctx.turn().
        if (opts?.persistent) {
          session.persistentWorker = true;
          // ADR-0050: persistiert, damit die K7-Recovery nach einem Crash
          // weiß, dass adapter.recover() auch ohne offenen Zug sinnvoll ist
          // (Adoption des weiterlaufenden Prozesses).
          session.record.persistentWorker = true;
          this.persist(session.record);
          this.trackPersistentWorker(session, proc, signal);
        } else await this.trackTurn(session, proc);
        return proc;
      },
      adoptWorker: async (opts) => {
        const proc = (await this.runner.adopt?.(session.record.id)) ?? null;
        session.adopted = proc !== null;
        if (proc && opts?.persistent) {
          session.persistentWorker = true;
          session.record.persistentWorker = true;
          this.persist(session.record);
          this.trackPersistentWorker(session, proc, signal);
        }
        if (proc && !opts?.persistent) await this.trackTurn(session, proc);
        return proc;
      },
      turn: (state) => {
        if (signal.aborted) return;
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
      ...(e.tokensSource !== undefined ? { tokensSource: e.tokensSource } : {}),
      ...(e.costSource !== undefined ? { costSource: e.costSource } : {}),
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
      // T7.7: per-turn evidence — "no number" stays visibly unknown.
      session.record.metrics = metricsState(countMetrics((session.record.metrics as SessionMetricsState).counters, e));
      // T8.1: the card shows what happened last, in words.
      const act = activityOf(e);
      if (act) session.record.lastActivity = act;
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
    // EPIC-P21 T21.3: a finished turn becomes a measurement (derived from the stream, K7).
    if (enforced.some((e) => e.type === "system" && (e.payload as { kind?: unknown }).kind === "session.turn_end")) {
      void this.recordTurnMetrics(session.record.id).catch((err) => this.logger.warn("turn metrics not recorded", { sessionId: session.record.id, err: err instanceof Error ? err.message : String(err) }));
    }
    this.maybeTitleWithModel(session, enforced);
    // BUG-0048: the provider moved on — "Freigabe nötig" without an open request is stale.
    if (session.record.status === "waiting_approval" && enforced.some((e) => ["assistant", "tool_use", "tool_result", "thinking"].includes(e.type))) {
      void this.healWaitingApproval(session, false).catch((err) => this.logger.warn("waiting_approval heal failed", { sessionId: session.record.id, err: err instanceof Error ? err.message : String(err) }));
    }
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

  /**
   * BUG-0048: "waiting_approval" is only true while a tool request is open. A hub restart in the
   * middle of one (the bridge's answer never arrived) or a request that timed out meanwhile left
   * it standing — the overview then showed "Braucht dich" with nothing to decide.
   */
  private async healWaitingApproval(session: LiveSession, afterRestart: boolean): Promise<void> {
    if (session.record.status !== "waiting_approval") return;
    if (this.operationStore.list(["pending"], session.record.id).some((o) => o.kind === "tool.permission")) return;
    // EPIC-P29: Warten auf eine Manifest-Freigabe ist echtes Warten — kein
    // Tool-Rest, der "geheilt" werden dürfte. Abgelehnt/abgelaufen wird
    // laut fehlerhaft; entschieden (approved) gehört der Operation.
    const wsApproval = (this.workspaceApprovals ?? this.approvals)?.list().find((a) => a.sessionId === session.record.id && a.action === "workspace.setup");
    if (wsApproval) {
      if (wsApproval.status === "pending") return;
      if (wsApproval.status === "rejected" || wsApproval.status === "timed_out") {
        await this.failWorkspace(session, session.workspace?.manifestHash ?? null, session.workspace?.baseSha ?? session.record.worktreeSha ?? "", {
          step: "approval",
          kind: "unknown",
          detail: `Manifest-Freigabe ${wsApproval.status === "rejected" ? "abgelehnt" : "abgelaufen"}`,
          logBlobRef: null,
        });
      }
      return;
    }
    // After a restart no turn is known to be running unless the worker was adopted.
    const idle = afterRestart && (session.adopted === false || !session.handle);
    await this.setStatus(session, idle ? "idle" : "working");
  }

  /** EPIC-P15 T15.5: model for short AI titles. Absent: titles come from the prompt only. */
  enableAiTitles(model: PlannerModelConfig | undefined): void {
    this.titleModel = model;
  }

  /** EPIC-P15 T15.5: once per session, after the first real answer. Fire and forget: a slow or
   * failing model never holds up the stream, and the prompt-based title stays when it fails. */
  private maybeTitleWithModel(session: LiveSession, events: readonly NormalizedEvent[]): void {
    if (!this.titleModel || session.aiTitleTried || session.record.titleSource !== "auto") return;
    const answer = events.find((e) => e.type === "assistant" && typeof (e.payload as { text?: unknown }).text === "string" && (e.payload as { text: string }).text.trim());
    const prompt = session.titlePrompt ?? session.record.title;
    if (!answer || !prompt) return;
    session.aiTitleTried = true;
    const text = (answer.payload as { text: string }).text;
    void (async () => {
      const title = await askTitleModel(this.titleModel!, prompt, text);
      if (!title || session.record.titleSource !== "auto") return; // none, or renamed meanwhile
      session.record.title = title;
      session.record.titleSource = "ai";
      session.record.updatedAt = new Date().toISOString();
      this.persist(session.record);
      await this.emitSystem(session, "session.titled", { title, source: "ai" });
    })().catch((err) => this.logger.warn("ai title failed", { sessionId: session.record.id, err: err instanceof Error ? err.message : String(err) }));
  }

  private async emitSystem(session: LiveSession, kind: string, payload: Record<string, unknown>): Promise<void> {
    await this.emitEvents(session, [
      { type: "system", summary: kind === "session.interrupted" ? `${kind}: ${String(payload.reason)}` : kind, payload: { kind, ...payload } },
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
    session.workerExitPending = false;
    if (session.record.status === "idle" || session.record.status === "error") await this.setStatus(session, "working");
    const signal = session.abort.signal;
    const parkGeneration = session.parkGeneration ?? 0;
    proc.onExit((code) => {
      if (signal.aborted) return;
      session.activeWorkers = Math.max(0, (session.activeWorkers ?? 1) - 1);
      if ((session.activeWorkers ?? 0) === 0) session.workerExitPending = true;
      if (parkGeneration !== (session.parkGeneration ?? 0)) return;
      if (code !== 0) {
        this.scheduleInterruption(session, signal);
        return;
      }
      setTimeout(() => {
        if (signal.aborted || (session.activeWorkers ?? 0) > 0 || session.record.status !== "working") return;
        void this.setStatus(session, "idle")
          .then(() => this.emitSystem(session, "session.turn_end", { code }))
          .catch((err) => this.logger.warn("turn end not recorded", { sessionId: session.record.id, err: String(err) }));
      }, TURN_END_SETTLE_MS).unref();
    });
  }

  private trackPersistentWorker(session: LiveSession, proc: WorkerProcess, signal: AbortSignal): void {
    proc.onExit(() => this.scheduleInterruption(session, signal));
  }

  private scheduleInterruption(session: LiveSession, signal: AbortSignal): void {
    // Give the adapter's exit callback time to journal a provider error.
    setTimeout(() => {
      if (signal.aborted || (session.activeWorkers ?? 0) > 0) return;
      void this.interruption.interrupt(session, "worker_exit").catch((err) => this.logger.error("interruption not recorded", { sessionId: session.record.id, err: String(err) }));
    }, TURN_END_SETTLE_MS).unref();
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
    if (status === "idle") this.scheduleDrain(session.record.id);
  }

  /** EPIC-P15 T15.3: the turn ended — send the oldest queued prompt. One at a time:
   * its own turn end sends the next. */
  private scheduleDrain(sessionId: string): void {
    if (this.draining.has(sessionId) || this.queue.count(sessionId) === 0) return;
    this.draining.add(sessionId);
    setTimeout(() => {
      void this.drainNext(sessionId)
        .catch((err) => this.logger.warn("queue drain failed", { sessionId, err: err instanceof Error ? err.message : String(err) }))
        .finally(() => this.draining.delete(sessionId));
    }, 0);
  }

  /** T17.4: check, take and submit run as one task inside the session's
   * steer chain. A prompt steer that came in mid-flight has fully settled
   * by then (its status flip can lag behind its own spawn), so a queued
   * entry is never sent into a turn it was never queued for — the wait
   * stays pinned to the turn that ended (occupant pinning). */
  private drainNext(sessionId: string): Promise<void> {
    const previous = this.steerQueue.get(sessionId) ?? Promise.resolve();
    const run = previous.then(
      () => this.drainSlot(sessionId),
      () => this.drainSlot(sessionId),
    );
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

  private async drainSlot(sessionId: string): Promise<void> {
    const session = this.live.get(sessionId);
    if (!session || session.record.status !== "idle") return;
    const item = this.queue.take(sessionId);
    if (!item) return;
    const ack = await this.steerNow(
      sessionId,
      { kind: "prompt", text: item.text, ...(item.attachments ? { attachments: item.attachments } : {}) },
      item.actor ?? undefined,
      { fromQueue: true },
    );
    await this.emitSystem(session, "session.dequeued", { queueId: item.id, ok: ack.ok, ...(ack.ok ? {} : { detail: ack.detail ?? null }) });
  }

  /** EPIC-P15 T15.3: what is waiting in this session. */
  queued(sessionId: string): QueuedPrompt[] {
    return this.queue.list(sessionId);
  }

  /** EPIC-P15 T15.3: drop one waiting prompt before it is sent. */
  async unqueue(sessionId: string, queueId: string, actor?: string): Promise<boolean> {
    const removed = this.queue.remove(sessionId, queueId);
    const session = this.live.get(sessionId);
    if (removed && session) await this.emitSystem(session, "session.unqueued", { queueId, actor: actor ?? null });
    return removed;
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
      title: record.title,
      preview: record.lastActivity?.text ?? null,
      live: record.status === "working" || record.status === "starting",
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
