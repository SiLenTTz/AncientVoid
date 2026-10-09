#!/usr/bin/env node
/**
 * UACC hub daemon entry.
 *
 *   UACC_CONFIG=./hub.config.json node src/main.ts
 *
 * Boot order (P0): config → db → adapters → recovery (K7) → HTTP/WS → PWA.
 */
import { chmodSync, mkdirSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { toHostId } from "@uacc/contracts";
import { resolve } from "node:path";
import type { WorkerRunner, DiscoverySource } from "@uacc/contracts";
import {
  Gatekeeper,
  PushService,
  AttachmentStore,
  MediaJobs,
  DesktopService,
  SettingsStore,
  AdapterRegistry,
  ApprovalService,
  EventStore,
  HubDatabase,
  acquireHubPidLock,
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
  defaultOpencodeDataDir,
  opencodeDiscoverySource,
  type HubConfig,
} from "@uacc/core";
import { TmuxRunner, ProcessRunner } from "@uacc/workers";
import type { AdapterFactory } from "@uacc/contracts";
import { createHubApp } from "./app.ts";
import { createPermissionBridge } from "./modules/approvals/permission-bridge.ts";

// `dummy` used to be hardcoded here, always visible in every real hub's
// adapter list/status rows regardless of whether anyone wanted it — real
// user feedback (2026-09-19): looks like test clutter next to genuine
// providers. It's a completely normal adapter otherwise (@uacc/adapter-dummy,
// same registration path as claude/codex/etc.) — add it to
// hub.config.json's own `adapters` array, same as any other adapter, when
// you actually want it for local testing.
const BUILTIN_ADAPTERS: Record<string, AdapterFactory> = {};
let releaseHubPidLock: (() => Promise<void>) | undefined;

function discoverySources(config: HubConfig): DiscoverySource[] {
  const sources: DiscoverySource[] = [];
  const claudeDir = config.discovery.claudeDir ? resolve(config.discovery.claudeDir) : defaultClaudeDir();
  const cursorUserDir = config.discovery.cursorUserDir ? resolve(config.discovery.cursorUserDir) : defaultCursorUserDir();
  if (config.discovery.claudeDir || existsSync(claudeDir)) sources.push(claudeDiscoverySource(claudeDir, config.projectRoots));
  if (config.discovery.cursorUserDir || existsSync(cursorUserDir)) sources.push(cursorDiscoverySource(cursorUserDir));
  const opencodeDataDir = config.discovery.opencodeDataDir ? resolve(config.discovery.opencodeDataDir) : defaultOpencodeDataDir();
  if (config.discovery.opencodeDataDir || existsSync(opencodeDataDir)) sources.push(opencodeDiscoverySource(opencodeDataDir, config.projectRoots));
  return sources;
}

async function main(): Promise<void> {
  // Hub data includes local credentials and user content; future files,
  // WAL/SHM sidecars, worker logs and attachment directories stay private.
  process.umask(0o077);
  const configPath = resolve(process.env.UACC_CONFIG ?? "hub.config.json");
  const { config } = await loadConfig(configPath);
  const dataDir = resolve(config.dataDir);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  chmodSync(dataDir, 0o700);
  releaseHubPidLock = await acquireHubPidLock(dataDir);

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
  // ADR-0011 Erweiterung: mirror sessions read the same store the
  // discovery scan uses — one resolved path, two features.
  const opencodeDataDir = config.discovery.opencodeDataDir ? resolve(config.discovery.opencodeDataDir) : defaultOpencodeDataDir();
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
    opencodeDataDir,
    config.defaultPermissionMode,
  );

  // T7.2 / ADR-0018 §3: providers ask before a tool runs — always through
  // the approval queue, independent of requireStepApprovals.
  const loopHost = config.server.host === "0.0.0.0" ? "127.0.0.1" : config.server.host;
  // T7.9 (ADR-0024): every tool request is labelled before it is shown.
  const gk = config.gatekeeper;
  const gatekeeperKey = gk.model?.apiKeyFile ? (await readFile(resolve(gk.model.apiKeyFile.replace(/^~(?=\/)/, homedir())), "utf8").catch(() => "")).split("\n")[0]?.trim() : undefined;
  if (gk.model?.apiKeyFile && !gatekeeperKey) logger.warn("gatekeeper key file unreadable — model calls will fail (fail-closed)", { file: gk.model.apiKeyFile });
  const gatekeeper = gk.enabled
    ? new Gatekeeper({
        ...(gk.model ? { model: { url: gk.model.url, model: gk.model.model, ...(gatekeeperKey ? { apiKey: gatekeeperKey } : {}) } } : {}),
        timeoutMs: gk.timeoutMs,
        minConfidence: gk.minConfidence,
      })
    : undefined;
  // T9.2: the same local model serves text commands unless one is set apart.
  const assistantCfg = config.assistant.model ?? gk.model;
  const assistantKey = assistantCfg?.apiKeyFile ? (await readFile(resolve(assistantCfg.apiKeyFile.replace(/^~(?=\/)/, homedir())), "utf8").catch(() => "")).split("\n")[0]?.trim() : undefined;
  const assistantModel = assistantCfg ? { url: assistantCfg.url, model: assistantCfg.model, ...(assistantKey ? { apiKey: assistantKey } : {}) } : undefined;
  sessions.enableToolPermissions({
    approvals,
    timeoutMs: config.toolApprovalTimeoutMs,
    bridge: createPermissionBridge({ tokens, hubUrl: `http://${loopHost}:${config.server.port}`, dir: resolve(dataDir, "bridges") }),
    ...(gatekeeper ? { gatekeeper } : {}),
  });

  // T7.10 (ADR-0022): uploaded files, local extraction first, Gemini only
  // with a key the user set in the PWA settings.
  const settings = new SettingsStore(db);
  // T8.3 (ADR-0026): Web Push — off until a person turns it on.
  const push = new PushService(db, settings, { hostId: config.hostId ?? toHostId(hostname()), subject: config.push.subject });
  sessions.onNotification((n) => push.notify(n));
  const tessdataDir = config.ocr.tessdataDir ? resolve(config.ocr.tessdataDir) : undefined;
  const attachments = new AttachmentStore(db, resolve(dataDir, "attachments"), () => ({ gemini: settings.gemini(), ...(tessdataDir ? { tessdataDir } : {}) }));

  // EPIC-P10.5 (ADR-0030): video analysis — local services first, Gemini
  // only for jobs that allow the cloud.
  const mc = config.media;
  const visionKey = mc.vision?.apiKeyFile ? (await readFile(resolve(mc.vision.apiKeyFile.replace(/^~(?=\/)/, homedir())), "utf8").catch(() => "")).split("\n")[0]?.trim() : undefined;
  const media = mc.enabled
    ? new MediaJobs(db, {
        dir: resolve(dataDir, "media"),
        attachments,
        ...(config.stt ? { stt: { url: config.stt.url, timeoutMs: 15 * 60_000 } } : {}),
        ...(assistantModel ? { summaryModel: { ...assistantModel, timeoutMs: 10 * 60_000 } } : {}),
        ...(mc.vision ? { vision: { url: mc.vision.url, model: mc.vision.model, ...(visionKey ? { apiKey: visionKey } : {}) } } : {}),
        gemini: () => settings.gemini(),
        ytDlp: mc.ytDlp,
        keepSource: mc.keepSource,
        limits: { maxDurationSec: mc.maxDurationSec, maxBytes: mc.maxBytes, maxFrames: mc.maxFrames },
        tessdataDir,
        log: (message, meta) => logger.warn(message, meta ?? {}),
      })
    : undefined;

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
    actions: config.actions,
    ...(assistantModel ? { assistantModel } : {}),
    ...(config.stt ? { stt: {
      url: config.stt.url,
      engine: config.stt.engine,
      language: config.stt.language,
      vocabulary: config.stt.vocabulary,
      timeoutMs: config.stt.timeoutMs,
      ...(config.stt.streaming ? { streaming: {
        url: config.stt.streaming.url,
        endpointingMs: config.stt.streaming.endpointingMs,
        ...(config.stt.streaming.apiKeyFile ? { apiKeyFile: resolve(config.stt.streaming.apiKeyFile.replace(/^~(?=\/)/, homedir())) } : {}),
      } } : {}),
    } } : {}),
    // EPIC-P11 (ADR-0031): the desktop companion's queue — always there; a
    // PC appears once a companion with a `companion:` token reports in.
    desktop: new DesktopService(db),
    ...(media ? { media: { media, ytDlp: mc.ytDlp, capabilities: { stt: Boolean(config.stt), summary: Boolean(assistantModel), vision: Boolean(mc.vision) } } } : {}),
    approvals,
    attachments,
    settings,
    push,
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
  const resumed = media?.resume() ?? 0;
  if (resumed) logger.info("media jobs resumed", { count: resumed });
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
    await releaseHubPidLock?.();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch(async (err) => {
  await releaseHubPidLock?.();
  createJsonLogger({ fields: { service: "uacc-hub" } }).error("fatal", {
    err: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
