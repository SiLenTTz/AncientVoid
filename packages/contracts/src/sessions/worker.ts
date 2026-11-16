import type { WorkerProcess } from "../harness/adapter.ts";

/**
 * Worker runner abstraction (ADR-P0-3 + premortem #2): tmux is the default,
 * but it stays behind this interface so alternative runners (plain
 * child_process, WSL, remote) can be plugged without touching adapters.
 */
export interface WorkerSpec {
  /** Unique worker name; the tmux runner prefixes it with "ancientvoid-". */
  name: string;
  /** T17.5/ADR-0037: hub session id this worker belongs to — written as the
   * tmux session option @ancientvoid_session and pane env ANCIENTVOID_SESSION_ID. Identity
   * after a hub restart comes from this marker; `name` is only the fallback.
   * Values are hub-internal ids (randomUUID), never user input. */
  sessionId?: string;
  cwd: string;
  cmd: string[];
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  /** T7.2: "pipe" gives the worker a real stdin stream (JSON-RPC agents
   * such as ACP). Default "tty": input arrives as typed keys. */
  stdin?: "tty" | "pipe";
}

export interface WorkerInfo {
  name: string;
  /** Full session name including prefix, if runner uses namespacing. */
  fullName: string;
  /** T17.5/ADR-0037: the hub session id from @ancientvoid_session, when the
   * runner sets it. Absent = pre-marker worker (fallback path). */
  sessionId?: string;
  /** T17.5/ADR-0037: stable per-spawn worker id (@ancientvoid_worker, randomUUID). */
  workerId?: string;
  /** BUG-0157 (ADR-0037-Nachtrag): Generations-Logpfad dieser Spawn-Generation
   * (@ancientvoid_log) — Adoption findet das Log über den Marker, nicht über
   * den wiederverwendbaren Sessionnamen. */
  log?: string;
  pid?: number;
  createdAt?: number;
}

export interface WorkerRunner {
  readonly kind: string;
  /** Whether this runner works on the current machine (tmux binary present…). */
  isAvailable(): Promise<boolean>;
  spawn(spec: WorkerSpec): Promise<WorkerProcess>;
  /** List workers created by this runner (prefix-filtered). */
  list(): Promise<WorkerInfo[]>;
  /** Kill a worker by full name. Resolves when gone. */
  killByName(fullName: string, signal?: "SIGTERM" | "SIGKILL"): Promise<void>;
  /** Kill everything with our prefix that is not in `keep` (orphan reaping at daemon start). */
  reapOrphans(keep: readonly string[]): Promise<string[]>;
  /** ADR-0014: take over a still running worker of this runner after a hub
   * restart; output resumes after the last delivered line. Runners whose
   * workers die with the hub (process) leave this out.
   * T17.6/ADR-0037: identifies the worker primarily via the marker
   * (WorkerInfo.sessionId); the name is the logged fallback. */
  adopt?(sessionId: string): Promise<WorkerProcess | null>;
}
