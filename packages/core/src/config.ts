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
