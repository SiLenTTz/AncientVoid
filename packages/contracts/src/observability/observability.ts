/**
 * Observability surface shared by core, server and hubctl (ADR-0010).
 * Adapters keep using AdapterContext.log — they never import this.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

export interface HubLogger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(fields: LogFields): HubLogger;
}

export interface HubMetricsSnapshot {
  ts: string;
  counters: Record<string, number>;
  gauges: Record<string, number>;
}

export interface HubMetrics {
  inc(name: string, by?: number): void;
  gauge(name: string, value: number): void;
  snapshot(): HubMetricsSnapshot;
}

export interface HubHealthCheck {
  ok: boolean;
  detail?: string;
}

export type HubHealthStatus = "ok" | "degraded" | "down";

/** BUG-0074/0075: Heap-Füllstand des Hub-Prozesses — früh warnen statt erst am OOM zu sterben. */
export interface HubMemoryCheck extends HubHealthCheck {
  level: "ok" | "warn" | "critical";
  heapUsedMb: number;
  heapLimitMb: number;
  rssMb: number;
}

export interface HubHealthSessions {
  live: number;
  total: number;
  byStatus: Record<string, number>;
}

export interface HubHealthReport {
  deployment?: DeploymentIdentity;
  ok: boolean;
  status: HubHealthStatus;
  serverTime: string;
  uptimeSec: number;
  adapters: Array<{
    id: string;
    version: string;
    capabilities: unknown;
    module?: string;
  }>;
  sessions: HubHealthSessions;
  checks: {
    database: HubHealthCheck;
    eventStore: HubHealthCheck;
    memory?: HubMemoryCheck;
  };
}

/** Shared redaction keys for HubLogger and Fastify pino (ADR-0010). */
export const REDACT_LOG_KEYS = [
  "authorization",
  "token",
  "cookie",
  "password",
  "secret",
  "apiKey",
  "api_key",
] as const;
/** ADR-0076: loaded server, checkout and built browser assets are distinct. */
export interface DeploymentIdentity {
  runtimeDirty: boolean | null;
  checkoutDirty: boolean | null;
  pwaDirty: boolean | null;
  runtimeSha: string | null;
  checkoutSha: string | null;
  pwaSha: string | null;
  builtAt: string | null;
  consistent: boolean | null;
}
