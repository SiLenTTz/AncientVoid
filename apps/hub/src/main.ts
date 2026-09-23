#!/usr/bin/env node
/**
 * UACC hub daemon entry.
 *
 *   UACC_CONFIG=./hub.config.json node src/main.ts
 *
 * Boot order (P0): config → db → adapters → recovery (K7) → HTTP/WS → PWA.
 */
import { mkdirSync, existsSync } from "node:fs";
import { hostname } from "node:os";
import { toHostId } from "@uacc/contracts";
import { resolve } from "node:path";
import type { WorkerRunner, DiscoverySource } from "@uacc/contracts";
import {
  AdapterRegistry,
  ApprovalService,
  EventStore,
  HubDatabase,
  SessionManager,
  TokenService,
  WebAuthnStore,
  WorktreeManager,
  createJsonLogger,
  InMemoryMetrics,
  loadConfig,
  loadReportingSinks,
  claudeDiscoverySource,
  cursorDiscoverySource,
  defaultClaudeDir,
  defaultCursorUserDir,
  type HubConfig,
} from "@uacc/core";
import { TmuxRunner, ProcessRunner } from "@uacc/workers";
import type { AdapterFactory } from "@uacc/contracts";
import { createHubApp } from "./app.ts";

// `dummy` used to be hardcoded here, always visible in every real hub's
// adapter list/status rows regardless of whether anyone wanted it — real
// user feedback (2026-09-19): looks like test clutter next to genuine
// providers. It's a completely normal adapter otherwise (@uacc/adapter-dummy,
// same registration path as claude/codex/etc.) — add it to
// hub.config.json's own `adapters` array, same as any other adapter, when
// you actually want it for local testing.
const BUILTIN_ADAPTERS: Record<string, AdapterFactory> = {};

function discoverySources(config: HubConfig): DiscoverySource[] {
  const sources: DiscoverySource[] = [];
  const claudeDir = config.discovery.claudeDir ? resolve(config.discovery.claudeDir) : defaultClaudeDir();
  const cursorUserDir = config.discovery.cursorUserDir ? resolve(config.discovery.cursorUserDir) : defaultCursorUserDir();
  if (config.discovery.claudeDir || existsSync(claudeDir)) sources.push(claudeDiscoverySource(claudeDir));
  if (config.discovery.cursorUserDir || existsSync(cursorUserDir)) sources.push(cursorDiscoverySource(cursorUserDir));
  return sources;
}

async function main(): Promise<void> {
  const configPath = resolve(process.env.UACC_CONFIG ?? "hub.config.json");
  const { config } = await loadConfig(configPath);
  const dataDir = resolve(config.dataDir);
  mkdirSync(dataDir, { recursive: true });

  // M-2 (red-team review, 2026-09-18, T4.10): an empty projectRoots is a
  // real, honestly-documented default (isProjectPathAllowed() then
  // accepts any path — packages/core/src/projects.ts), but it was silent
  // at startup, unlike every other security-relevant default this hub
  // already warns about (UACC_EXPOSE, WebAuthn's localhost-only rpId).
  const logger = createJsonLogger({ fields: { service: "uacc-hub" } });
  const metrics = new InMemoryMetrics();
  const startedAt = Date.now();

  if (config.projectRoots.length === 0) {
    logger.warn(
      "projectRoots is empty — any authenticated device can start a session against ANY filesystem path the hub process can read. Set projectRoots in hub.config.json to restrict this.",
    );
  }

  const db = new HubDatabase(resolve(dataDir, "hub.db"));
  const store = new EventStore(dataDir);
  const tokens = new TokenService(db);

  // Worker runner: config.workerRunner, with a process fallback when tmux
  // is asked for but missing.
  let runner: WorkerRunner =
    config.workerRunner === "process" ? new ProcessRunner() : new TmuxRunner(resolve(dataDir, "workers"));
  if (!(await runner.isAvailable())) {
    logger.warn("tmux not available — falling back to process runner (no attach, no survival across restarts)");
    runner = new ProcessRunner();
  }

  // Adapter registry: built-ins + config modules (own providers/endpoints).
  const registry = new AdapterRegistry();
  for (const [id, factory] of Object.entries(BUILTIN_ADAPTERS)) {
    registry.register(id, factory);
  }
  if (config.adapters.length > 0) {
    await registry.loadAll(config.adapters, configPath);
  }
  logger.info("adapters loaded", {
    adapters: registry.list().map((a) => `${a.id}@${a.adapter.version}`).join(", ") || "(none)",
  });

  // T2.1: real per-session git worktree isolation (EPIC-P2). Projects that
  // aren't a git repo fall back to running in-place — see
  // WorktreeManager's own doc comment for why that's a named fallback, not
  // a silent gap.
  const worktrees = new WorktreeManager(resolve(dataDir, "worktrees"));
  // T2.4: the queue + its REST routes are always real and reachable
  // (config.requireStepApprovals only controls whether SessionManager
  // actually gates steer(prompt) behind it) — see HubConfig's own doc
  // comment for why the gate itself defaults off.
  const approvals = new ApprovalService(db);
  // T4.1/ADR-0009: empty by default (HubConfig.reportingSinks.default([])) —
  // no digests, no new network egress unless an operator explicitly
  // configures a sink module.
  const reportingSinks = await loadReportingSinks(config.reportingSinks, configPath);
  if (reportingSinks.length > 0) {
    logger.info("reporting sinks configured", { count: reportingSinks.length });
  }
  const sessions = new SessionManager(
    db,
    store,
    registry,
    runner,
    undefined,
    worktrees,
    config.requireStepApprovals ? approvals : undefined,
    config.dailyCapUsd,
    reportingSinks,
    { logger: logger.child({ component: "sessions" }), metrics },
  );

  // K7: recover sessions from JSONL + snapshots before accepting traffic.
  const recovery = await sessions.recoverAll();
  logger.info("recovery finished", {
    recovered: recovery.recovered,
    failed: recovery.failed,
    reaped: recovery.reaped.length,
  });

  const app = await createHubApp({
    sessions,
    tokens,
    registry,
    auth: {
      tokens,
      enforceTailnetIdentity: config.server.enforceTailnetIdentity,
    },
    ...(config.server.pwaDir ? { pwaDir: resolve(config.server.pwaDir) } : {}),
    projectRoots: config.projectRoots.map((root) => resolve(root)),
    approvals,
    dataDir,
    workerRunnerKind: runner.kind,
    store,
    metrics,
    startedAt,
    // T2.5: always real and reachable, same reasoning as `approvals`
    // above — see HubConfig.webauthn's doc comment for why the shipped
    // rpId/origin defaults only work for local dev.
    webauthn: { store: new WebAuthnStore(db), config: config.webauthn },
    discoverySources: discoverySources(config),
    hostId: config.hostId ?? toHostId(hostname()),
  });

  const listen = config.server.host === "127.0.0.1" && process.env.UACC_EXPOSE === "1"
    ? "0.0.0.0"
    : config.server.host;
  await app.listen({ port: config.server.port, host: listen });
  logger.info("listening", { host: config.server.host, port: config.server.port, dataDir });
  if (config.server.host === "127.0.0.1" && !process.env.UACC_EXPOSE) {
    logger.info("bound to loopback — expose via tailscale serve, never via public bind");
  }

  const shutdown = async (sig: string) => {
    logger.info("shutting down", { signal: sig });
    // tmux workers outlive the hub: a planned restart keeps them running and
    // the next start takes them over instead of stopping every session.
    const keepWorkers = runner.kind === "tmux";
    logger.info("stopping hub", { keepWorkers });
    await sessions.shutdown({ keepWorkers }).catch(() => undefined);
    await app.close().catch(() => undefined);
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  createJsonLogger({ fields: { service: "uacc-hub" } }).error("fatal", {
    err: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
