import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Adapter, NormalizedEvent, SessionHandle, SessionRecord, SessionStatus } from "@uacc/contracts";

export const WRITER_LEASE_MS = 30_000;

export interface SteerMeta {
  inputId?: string;
  revision?: number;
  clientId?: string;
  /** T5.5: take the writer lease from another device on purpose. Input-id
   * and revision checks still apply. */
  takeover?: boolean;
}

export interface LiveSession {
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
  /** T5.4: provider workers of this session that have not exited yet. */
  activeWorkers?: number;
  /** T5.6: result of ctx.adoptWorker() during recover(), if it was asked. */
  adopted?: boolean;
}

/** A turn counts as over only if no new worker starts within this window —
 * some adapters run a short probe (`--version`) right before the turn. */
export const TURN_END_SETTLE_MS = 250;

/** Overview title: the first line that says something, without the
 * prefixes the composer adds (Workflow:, /skill, Agent:, Ziel:). */
export function sessionTitle(prompt: string): string | null {
  const line = prompt
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !/^(workflow|agent):\s/i.test(l) && !/^\/[\w-]+$/.test(l));
  if (!line) return null;
  const text = line.replace(/^(ziel|goal):\s*/i, "");
  return text.length > 80 ? `${text.slice(0, 79).trimEnd()}…` : text;
}

export function readSkillName(args: Record<string, unknown> | undefined): string | undefined {
  const skill = args?.skill;
  return typeof skill === "string" && skill.length > 0 ? skill : undefined;
}

export function skillNameFromEvents(events: readonly NormalizedEvent[]): string | undefined {
  for (const event of events) {
    const payload = event.payload as { kind?: unknown; args?: unknown };
    if (payload.kind !== "session.created" || !payload.args || typeof payload.args !== "object") continue;
    return readSkillName(payload.args as Record<string, unknown>);
  }
  return undefined;
}

export function nativeIdFromEvents(events: readonly NormalizedEvent[]): string | undefined {
  let found: string | undefined;
  for (const event of events) {
    const native = (event.payload as { nativeSessionId?: unknown }).nativeSessionId;
    if (typeof native === "string" && native.length > 0) found = native;
  }
  return found;
}

export async function nativeIdFromWorkerLog(dataDir: string, sessionId: string): Promise<string | undefined> {
  try {
    const text = await readFile(join(dataDir, "workers", `uacc-${sessionId}.log`), "utf8");
    const ids = [...text.matchAll(/"session(?:ID|_id)"\s*:\s*"([^"]+)"/g)];
    return ids.at(-1)?.[1];
  } catch {
    return undefined;
  }
}

export const VALID_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  idle: ["working", "waiting_approval", "parked", "stopping", "stopped", "error"],
  starting: ["working", "idle", "waiting_approval", "error", "stopping", "stopped"],
  working: ["idle", "waiting_approval", "parked", "stopping", "stopped", "error"],
  waiting_approval: ["working", "parked", "stopping", "stopped", "error"],
  parked: ["working", "stopping", "stopped", "error"],
  stopping: ["stopped", "error"],
  stopped: ["working"],
  // ADR-0015: a failed turn (quota, rate limit, provider outage) is not a
  // dead session — the next prompt may start a new turn.
  error: ["stopping", "stopped", "working"],
};

/** T1.9: 30s default per EPIC-P1 §2 ("Heartbeat pro Adapter (30 s)"). */
export const DEFAULT_HEARTBEAT_MS = 30_000;
