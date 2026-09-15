import type { BlobRef, EmittedEvent } from "./event.ts";
import type { SessionSpec } from "./session.ts";

/**
 * What an adapter can do. Surfaced in dashboards, README matrix and the
 * MCP gateway catalog. Be honest — capabilities are promises (aSPARK lesson).
 */
export interface AdapterCapabilities {
  /** Adapter emits reasoning/thinking events. */
  reasoning: boolean;
  /** Adapter performs tool calls (tool_use/tool_result events). */
  tools: boolean;
  /** Adapter reports real cost (native) — else the hub estimates or shows "unknown". */
  cost: boolean;
  /** Adapter accepts steering input mid-session. */
  steer: boolean;
  /** Adapter can in principle report an account-level usage/quota snapshot
   * (ADR-0004) — "can", not "every session sees one" (same honesty
   * standard as `reasoning`/`cost`). codex: false, verified absent from
   * its stream and CLI, not merely unimplemented. */
  usage: boolean;
}

export type HealthState = "healthy" | "degraded" | "down" | "broken";

export interface HealthReport {
  state: HealthState;
  /** Human-readable detail, e.g. unknown event types seen (degraded), CLI missing (down). */
  detail?: string;
  /** ISO timestamp of last successful adapter interaction. */
  lastSeen?: string;
}

export type SteerKind = "prompt" | "stop" | "park" | "resume";

export const SteerInput = {
  prompt: (text: string) => ({ kind: "prompt", text }) as const,
  stop: () => ({ kind: "stop" }) as const,
  park: () => ({ kind: "park" }) as const,
  resume: () => ({ kind: "resume" }) as const,
} as const;

export type SteerInput =
  | { kind: "prompt"; text: string }
  | { kind: "stop" }
  | { kind: "park" }
  | { kind: "resume" };

export interface Ack {
  ok: boolean;
  detail?: string;
}

/** Handle returned by adapter.start(); opaque outside the adapter. */
export interface SessionHandle {
  readonly sessionId: string;
  /** OS pid of the underlying process, if any (tmux pane process, HTTP worker…). */
  readonly pid?: number;
  /** Adapter-internal bookkeeping (resume tokens etc.) — never interpreted by the hub. */
  readonly meta?: Readonly<Record<string, unknown>>;
}

/**
 * Process abstraction the hub hands to adapters. Implemented on top of the
 * configured WorkerRunner (tmux by default, plain child_process as fallback).
 * Adapters never spawn OS processes directly — this keeps workers attachable,
 * reapable and swappable (ADR-P0-3).
 */
export interface WorkerProcess {
  readonly pid?: number;
  /** tmux attach command for emergency debugging, if the runner supports it. */
  readonly attachCmd?: string;
  onStdout(cb: (chunk: string) => void): void;
  onStderr(cb: (chunk: string) => void): void;
  onExit(cb: (code: number | null) => void): void;
  /** Write to the process stdin (steering). */
  write(data: string): void;
  kill(signal?: "SIGTERM" | "SIGKILL"): Promise<void>;
  /** Resolve once the process exited. */
  exited(): Promise<{ code: number | null }>;
}

export interface SpawnOptions {
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  /** Name hint for the worker (defaults to session id). */
  name?: string;
}

/**
 * Everything an adapter may use from the hub. This is the adapter SDK
 * surface — keep it small, stable and testable.
 */
export interface AdapterContext {
  /** The hub-assigned session id — use for handle.sessionId and logging. */
  readonly sessionId: string;
  /** Emit a normalized event; hub assigns seq/ts/sessionId and enforces K5. */
  emit(event: EmittedEvent): void;
  /** Offload large content to the blob store, get a hash reference back. */
  blob(data: string | Uint8Array): Promise<BlobRef>;
  /** Spawn a managed worker process (tmux-backed by default). */
  spawnWorker(cmd: string[], opts?: SpawnOptions): Promise<WorkerProcess>;
  /** Structured adapter logging (goes to hub log, never to the event stream). */
  log(level: "debug" | "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>): void;
  /** Aborted when the session is stopped/parked — adapters must shut down. */
  signal: AbortSignal;
  /** Absolute working directory for this session (worktree path from P2). */
  workdir: string;
}

/**
 * THE adapter contract (PRD §4.2). Every provider integration — cloud CLI,
 * HTTP endpoint, local llama.cpp server, proprietary harness — implements
 * exactly this. If it can't be expressed here, extend the contract via an ADR,
 * don't special-case the hub.
 */
export interface Adapter {
  /** Stable adapter id, e.g. "claude", "codex", "local-llm", "dummy". */
  readonly id: string;
  /** Semver of the adapter itself. */
  readonly version: string;
  capabilities(): AdapterCapabilities;
  start(spec: SessionSpec, ctx: AdapterContext): Promise<SessionHandle>;
  steer(handle: SessionHandle, input: SteerInput, ctx: AdapterContext): Promise<Ack>;
  status(handle: SessionHandle): Promise<HealthReport>;
  stop(handle: SessionHandle, ctx: AdapterContext): Promise<void>;
  /**
   * Optional: recover after a hub crash (K7). Receives the last emitted seq.
   * Re-attach to still-running workers or restart generation; return a fresh
   * handle. Returning null marks the session unrecoverable (status error).
   */
  recover?(sessionId: string, lastSeq: number, ctx: AdapterContext): Promise<SessionHandle | null>;
}

/**
 * Adapters are factories: `createAdapter(config?) => Adapter`.
 * This shape enables loading from npm packages and local paths alike.
 */
export type AdapterFactory = (config?: Readonly<Record<string, unknown>>) => Adapter;

/** Minimal shape check a loaded module must satisfy to be accepted by the registry. */
export function isValidAdapterFactory(mod: unknown): mod is { createAdapter: AdapterFactory } {
  if (typeof mod !== "object" || mod === null) return false;
  const fn = (mod as { createAdapter?: unknown }).createAdapter;
  return typeof fn === "function";
}
