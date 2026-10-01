/** Platform services (ADR-0020): no module imports from here in reverse. */
export { EventStore } from "./eventstore.ts";
export { createJsonLogger, createConsoleLogger, redactFields } from "./logger.ts";
export { InMemoryMetrics } from "./metrics.ts";
export { HubDatabase, MIGRATIONS, type Migration } from "./db.ts";
export { acquireHubPidLock, acquireBackupLock } from "./datadir-lock.ts";
export { HubConfig, AdapterRegistration, ReportingSinkRegistration, DEFAULT_CONFIG, loadConfig, resolveAdapterModule, loadReportingSinks, type LoadedConfig, type BuiltinAdapters } from "./config.ts";
