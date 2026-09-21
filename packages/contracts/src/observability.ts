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

export interface HubHealthSessions {
  live: number;
  total: number;
  byStatus: Record<string, number>;
}

export interface HubHealthReport {
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
