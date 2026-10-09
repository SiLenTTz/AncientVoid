import { resolve, sep } from "node:path";
import type { FastifyRequest } from "fastify";
import type { ClaudeLive, PlannerModelConfig, AttachmentStore, SessionManager, TokenService, AdapterRegistry, ApprovalService, WebAuthnStore, HealthStore, ProbeRunner } from "@uacc/core";
import { nativeOpenCommand, scanProjectSkills, ensureBaseSkills } from "@uacc/core";
import { DEFAULT_HOST_ID } from "@uacc/contracts";
import type { ActionDefinition, HubMetrics, DiscoverySource, SessionRecord } from "@uacc/contracts";
import { TMUX_PREFIX } from "@uacc/workers";
import { extractToken } from "./platform/auth.ts";
import { createWebAuthnRoutes, type WebAuthnConfig } from "./modules/identity/webauthn.ts";

/** What the HTTP modules get from the hub (ADR-0020). */
export interface RouteDeps {
  /** T7.10: uploaded files (optional — a hub without them refuses attachment ids). */
  attachments?: AttachmentStore;
  sessions: SessionManager;
  tokens: TokenService;
  registry: AdapterRegistry;
  projectRoots?: string[];
  /** T2.4/EPIC-P2: optional, like SessionManager's worktrees/approvals
   * wiring — a hub without an ApprovalService configured just doesn't
   * expose the queue routes (501, not a crash). */
  approvals?: ApprovalService;
  /** T2.5: optional — a hub without WebAuthn configured doesn't expose
   * the passkey routes (501), same pattern as approvals above. */
  webauthn?: { store: WebAuthnStore; config: WebAuthnConfig };
  /** T3.9: optional — omitting it disables POST /api/prompt-optimizer/
   * feedback (501), same pattern as above. */
  dataDir?: string;
  /** Real user request (2026-09-19): surfaces a real `tmux attach`
   * command on a session when the worker runner is genuinely tmux —
   * see HubAppDeps's own doc comment for the full reasoning. */
  workerRunnerKind?: string;
  store?: HealthStore;
  metrics?: HubMetrics;
  startedAt?: number;
  /** ADR-0012: external read-only session sources mixed into GET /api/discovery. */
  discoverySources?: DiscoverySource[];
  /** EPIC-P15 T15.4: which Claude sessions are open at the PC (optional: no CLI, no hint). */
  claudeLive?: ClaudeLive;
  /** Injected in tests. Production uses spawnProbeRunner. */
  probeRunner?: ProbeRunner;
  /** EPIC-P6: this hub's host id in the fleet. */
  hostId?: string;
  /** T9.2: local model for text commands and text edits (ADR-0027). */
  assistantModel?: PlannerModelConfig;
  /** T7.6: actions from hub.config.json (`actions`). */
  actions?: ActionDefinition[];
}

/**
 * Shared by every module's routes: the hub's dependencies plus the few
 * helpers several modules need (caller label, attach command, skill
 * catalog). Built once in routes.ts.
 */
export function createRouteContext(deps: RouteDeps) {
  const projectRoots = deps.projectRoots ?? [];

  /** The configured root a project lives under, with its base skill
   * catalog in place. BUG-0021: a session started with a skill before
   * anyone listed skills found no catalog and ran a shorter extends chain. */
  async function catalogRootFor(project: string): Promise<string | undefined> {
    const projectPath = resolve(project);
    const root = projectRoots
      .map((entry) => resolve(entry))
      .filter((entry) => projectPath === entry || projectPath.startsWith(entry + sep))
      .sort((a, b) => b.length - a.length)[0];
    if (root) await ensureBaseSkills(root);
    return root;
  }

  async function skillsFor(project: string) {
    const root = await catalogRootFor(project);
    return scanProjectSkills(project, root && root !== resolve(project) ? { baseRoot: root } : undefined);
  }
  const webauthnRoutes = deps.webauthn ? createWebAuthnRoutes(deps.webauthn.store, deps.webauthn.config) : null;
  // T3.8: dedup concurrent ensureIndexed() calls for the same project — a
  // first-time index can take real minutes; without this, rapid repeated
  // searches while indexing would each kick off their own `qmd embed`.
  const indexingInFlight = new Map<string, Promise<void>>();
  // T2.8 (EPIC-P2 §2 audit trail "wer-wann-was"): the caller's own device
  // label, identify()d fresh from its already-authHook-verified bearer
  // token on every call — never trusted from anything client-supplied.
  function callerLabel(req: FastifyRequest): string | null {
    const raw = extractToken(req);
    if (!raw) return null;
    return deps.tokens.identify(raw)?.label ?? null;
  }

  // Real user request (2026-09-19): "same session on the phone and my
  // desktop terminal". Already true today — SessionManager.makeContext()
  // always names the worker after the real session id (session-manager.ts),
  // so the tmux pane name is deterministic and never needs plumbing
  // through SessionHandle/adapters. Only shown for a genuinely live
  // session on a genuinely tmux-backed hub — a stopped session's pane is
  // gone, and a `process`-runner hub has no pane to attach to at all.
  //
  // Since ADR-0013 a session between turns is `idle`, so `working` really
  // means a turn — and its pane — is running.
  async function withAttachCmd<T extends SessionRecord>(
    session: T,
  ): Promise<T & { attachCmd?: string; openCmd?: string; worktree?: { path: string; branch: string } }> {
    // T5.5: open the same provider session in its own terminal UI — only
    // while no turn runs here, so hub and terminal never write at once.
    const idle = session.status !== "working" && session.status !== "starting";
    const openCmd = idle
      ? nativeOpenCommand(session.adapter, session.nativeSessionId, deps.sessions.workdirOf(session.id) ?? session.project)
      : null;
    // Where the session's files really are — its own worktree, not the
    // project checkout the user has open in the editor.
    const workdir = deps.sessions.workdirOf(session.id);
    const worktree =
      session.worktreeSha !== null && workdir && workdir !== session.project
        ? { path: workdir, branch: `uacc/${session.id}` }
        : null;
    // ADR-0017: every session of this hub carries this hub's host id.
    const withOpen = { ...session, hostId, ...(openCmd ? { openCmd } : {}), ...(worktree ? { worktree } : {}) };
    if (deps.workerRunnerKind !== "tmux" || session.status !== "working") return withOpen;
    if (!(await deps.sessions.hasLiveWorker(session.id))) return withOpen;
    return { ...withOpen, attachCmd: `tmux attach -t ${TMUX_PREFIX}${session.id}` };
  }

  const startedAt = deps.startedAt ?? Date.now();
  const hostId = deps.hostId ?? DEFAULT_HOST_ID;

  return { deps, projectRoots, hostId, startedAt, catalogRootFor, skillsFor, callerLabel, withAttachCmd, webauthnRoutes, indexingInFlight };
}

export type RouteContext = ReturnType<typeof createRouteContext>;
