import { z } from "zod";
import type { AdapterFactory } from "@uacc/contracts";

export const AdapterRegistration = z.object({
  /** Adapter id as referenced by SessionSpec.adapter. */
  id: z.string().min(1),
  /**
   * Module specifier resolving to an adapter factory:
   *  - package name: "@uacc/adapter-claude" or any npm package
   *  - relative path: "./adapters/my-provider/index.ts" (relative to config file)
   *  - absolute path: "/opt/uacc/adapters/custom.mjs"
   */
  module: z.string().min(1),
  /** Adapter-specific config passed to the factory. */
  config: z.record(z.unknown()).optional(),
  /** Disable without removing the registration. */
  enabled: z.boolean().default(true),
});
export type AdapterRegistration = z.infer<typeof AdapterRegistration>;

export const HubConfig = z.object({
  dataDir: z.string().default("./data"),
  server: z
    .object({
      host: z.string().default("127.0.0.1"),
      port: z.number().int().default(7373),
      /**
       * Reject requests without Tailscale identity headers when served via
       * `tailscale serve`. Requires requests to come through the tailnet.
       */
      enforceTailnetIdentity: z.boolean().default(false),
      /** Directory containing the built PWA (served as static root). */
      pwaDir: z.string().optional(),
    })
    .default({}),
  adapters: z.array(AdapterRegistration).default([]),
  /** Worker runner kind: "tmux" (default) | "process". */
  workerRunner: z.enum(["tmux", "process"]).default("tmux"),
  /** T1.5-4: host paths to scan (depth 1) for git repos to offer as
   * session projects — see @uacc/core's discoverProjects(). Empty means
   * unconfigured: the PWA falls back to a free-text path (BUG-0006
   * lesson — don't make a fresh hub unusable), and POST /api/sessions
   * accepts any project path (pre-T1.5-4 behavior, unchanged). */
  projectRoots: z.array(z.string()).default([]),
  /** T2.4 (EPIC-P2 §3): gate every steer(prompt) behind the write-class
   * approval queue instead of forwarding it immediately. Defaults to
   * `false` — the service and its REST routes/PWA page are always real
   * and reachable regardless, but flipping the hub's core chat
   * interaction into a two-step approve-then-send flow is a deliberate
   * operator choice, not a silent default change to how every existing
   * session already behaves. */
  requireStepApprovals: z.boolean().default(false),
  /** T2.5: WebAuthn relying-party identity for destructive approvals.
   * Defaults suit local dev only (`localhost` origin) — a real Tailscale
   * deployment MUST override `rpId`/`origin` to the actual MagicDNS
   * hostname (e.g. "my-machine.tailXXXX.ts.net"), or every real
   * registration/assertion will fail its origin check (by design: that
   * check is what WebAuthn phishing-resistance depends on). */
  webauthn: z
    .object({
      rpId: z.string().default("localhost"),
      rpName: z.string().default("UACC"),
      origin: z.string().default("http://localhost:7373"),
    })
    .default({}),
  /** T2.7 (EPIC-P2 §3 "Tages-Cap pro Rechner"): sum of every session's
   * costUsd created since 00:00 UTC today, hub-wide, not per session —
   * protection against a runaway/looping agent regardless of any single
   * session's own budgetUsd. `null` (default) means no cap configured. */
  dailyCapUsd: z.number().positive().nullable().default(null),
});
export type HubConfig = z.infer<typeof HubConfig>;

export const DEFAULT_CONFIG: HubConfig = HubConfig.parse({});

export interface LoadedConfig {
  config: HubConfig;
  /** Absolute path of the config file (module resolution base). */
  path: string;
}

export async function loadConfig(
  path: string,
  overrides?: Partial<HubConfig>,
): Promise<LoadedConfig> {
  const { readFile } = await import("node:fs/promises");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    raw = "{}";
  }
  const parsed = HubConfig.parse(JSON.parse(raw));
  const config = overrides ? HubConfig.parse({ ...parsed, ...overrides }) : parsed;
  return { config, path };
}

/**
 * Resolve a module specifier from an adapter registration into something
 * `import()` understands. Relative paths resolve against the config file.
 */
export async function resolveAdapterModule(
  specifier: string,
  configPath: string,
): Promise<string> {
  const { isAbsolute, resolve } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  if (specifier.startsWith(".") || isAbsolute(specifier)) {
    const base = isAbsolute(specifier) ? specifier : resolve(configPath, "..", specifier);
    return pathToFileURL(base).href;
  }
  return specifier;
}

/** Built-in adapter factories shipped with the hub (wired by the server entry). */
export type BuiltinAdapters = Map<string, AdapterFactory>;
