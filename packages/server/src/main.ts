#!/usr/bin/env node
/**
 * UACC hub daemon entry.
 *
 *   UACC_CONFIG=./hub.config.json node src/main.ts
 *
 * Boot order (P0): config → db → adapters → recovery (K7) → HTTP/WS → PWA.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { WorkerRunner } from "@uacc/contracts";
import {
  AdapterRegistry,
  ApprovalService,
  EventStore,
  HubDatabase,
  SessionManager,
  TokenService,
  WebAuthnStore,
  WorktreeManager,
  loadConfig,
} from "@uacc/core";
import { TmuxRunner, ProcessRunner } from "@uacc/workers";
import { createAdapter as createDummyAdapter } from "@uacc/adapter-dummy";
import type { AdapterFactory } from "@uacc/contracts";
import { createHubApp } from "./index.ts";

const BUILTIN_ADAPTERS: Record<string, AdapterFactory> = {
  dummy: createDummyAdapter,
};

async function main(): Promise<void> {
  const configPath = resolve(process.env.UACC_CONFIG ?? "hub.config.json");
  const { config } = await loadConfig(configPath);
  const dataDir = resolve(config.dataDir);
  mkdirSync(dataDir, { recursive: true });

  const db = new HubDatabase(resolve(dataDir, "hub.db"));
  const store = new EventStore(dataDir);
  const tokens = new TokenService(db);

  // Worker runner: tmux when available, process fallback otherwise.
  let runner: WorkerRunner = new TmuxRunner(resolve(dataDir, "workers"));
  if (!(await runner.isAvailable())) {
    console.warn("[hub] tmux not available — falling back to process runner (no attach, no survival across restarts)");
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
  console.log(
    `[hub] adapters: ${registry.list().map((a) => `${a.id}@${a.adapter.version}`).join(", ") || "(none)"}`,
  );

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
  const sessions = new SessionManager(
    db,
    store,
    registry,
    runner,
    undefined,
    worktrees,
    config.requireStepApprovals ? approvals : undefined,
  );

  // K7: recover sessions from JSONL + snapshots before accepting traffic.
  const recovery = await sessions.recoverAll();
  console.log(
    `[hub] recovery: ${recovery.recovered} ok, ${recovery.failed} failed, ${recovery.reaped.length} workers reaped`,
  );

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
    // T2.5: always real and reachable, same reasoning as `approvals`
    // above — see HubConfig.webauthn's doc comment for why the shipped
    // rpId/origin defaults only work for local dev.
    webauthn: { store: new WebAuthnStore(db), config: config.webauthn },
  });

  const listen = config.server.host === "127.0.0.1" && process.env.UACC_EXPOSE === "1"
    ? "0.0.0.0"
    : config.server.host;
  await app.listen({ port: config.server.port, host: listen });
  console.log(`[hub] listening on http://${config.server.host}:${config.server.port} (data: ${dataDir})`);
  if (config.server.host === "127.0.0.1" && !process.env.UACC_EXPOSE) {
    console.log("[hub] bound to loopback — expose via `tailscale serve`, never via public bind");
  }

  const shutdown = async (sig: string) => {
    console.log(`[hub] ${sig} — shutting down`);
    await sessions.shutdown().catch(() => undefined);
    await app.close().catch(() => undefined);
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[hub] fatal:", err);
  process.exit(1);
});
