import { ActionDefinition } from "@uacc/contracts";
import { z } from "zod";
import type { AdapterFactory, ReportingSink } from "@uacc/contracts";

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

/** T4.1/ADR-0009: same module-specifier shape as AdapterRegistration
 * (package name / relative / absolute path), resolved through the same
 * resolveAdapterModule() — but the module exports `createSink(config?) =>
 * ReportingSink` instead of `createAdapter`. No `id`: sinks are never
 * looked up by name at runtime, only iterated. */
export const ReportingSinkRegistration = z.object({
  module: z.string().min(1),
  config: z.record(z.unknown()).optional(),
  enabled: z.boolean().default(true),
});
export type ReportingSinkRegistration = z.infer<typeof ReportingSinkRegistration>;

export const HubConfig = z.object({
  dataDir: z.string().default("./data"),
  /** EPIC-P6: this hub's name in the fleet. Default: the machine's
   * hostname as a slug (see toHostId). */
  hostId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/).optional(),
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
  /** T7.2: how long a provider's tool request or question waits for the
   * phone before it is denied (never run on timeout). */
  toolApprovalTimeoutMs: z.number().int().min(10_000).default(10 * 60_000),
  /** T7.10: local OCR — a tessdata dir with extra languages (e.g. deu),
   * set up by scripts/setup-ocr.sh without root. */
  ocr: z.object({ tessdataDir: z.string().optional() }).default({}),
  /** T7.6: registered actions (tests, tools) offered in every session,
   * next to the built-in git reads and the project's own test command. */
  actions: z.array(ActionDefinition).default([]),
  /** T9.2 (ADR-0027): local model for text commands and text edits;
   * absent → the gatekeeper's model, if any. Never a cloud fallback. */
  assistant: z
    .object({ model: z.object({ url: z.string().url(), model: z.string().min(1).default("qwen3-coder"), apiKeyFile: z.string().optional() }).optional() })
    .default({}),
  /** T10.2 (ADR-0028): local speech-to-text (whisper.cpp server on own
   * hardware). Absent → the PWA falls back to the browser's recognizer and
   * says that it is a cloud service. */
  stt: z
    .object({
      url: z.string().url(),
      engine: z.string().default("whisper.cpp large-v3-turbo"),
      language: z.string().default("de"),
      vocabulary: z
        .string()
        .max(1000)
        .default(
          "UACC, Session, Codex, Claude, opencode, TypeScript, JavaScript, Vitest, pytest, npm, pnpm, Pull Request, Branch, main, Rebase, Merge, Commit, Push, Worktree, Git Status, Diff, Build, Deploy, Logs, Cache, Cloud, Adapter, Hub, Tailnet, PWA, API, WebSocket, Service Worker, Docker, Container, llama.cpp, Gatekeeper, Readme, Doku, Kontingent, Unit-Test, Bug, Refactoring.",
        ),
      timeoutMs: z.number().int().min(1000).max(120_000).default(30_000),
    })
    .optional(),
  /** EPIC-P10.5 (ADR-0030): video analysis. Speech uses `stt`, chapters and
   * summary the assistant model; `vision` is an optional local image model
   * (llama.cpp with mmproj, OpenAI API). Gemini only per job, when allowed. */
  media: z
    .object({
      enabled: z.boolean().default(true),
      ytDlp: z.string().default("yt-dlp"),
      /** Keep the downloaded/uploaded video after the analysis (default: delete). */
      keepSource: z.boolean().default(false),
      maxDurationSec: z.number().int().min(10).max(4 * 3600).default(30 * 60),
      maxBytes: z.number().int().min(1024 * 1024).max(4 * 1024 * 1024 * 1024).default(500 * 1024 * 1024),
      maxFrames: z.number().int().min(1).max(200).default(24),
      vision: z.object({ url: z.string().url(), model: z.string().min(1), apiKeyFile: z.string().optional() }).optional(),
    })
    .default({}),
  /** T8.3 (ADR-0026): VAPID contact the push services see. */
  push: z.object({ subject: z.string().regex(/^(mailto:|https:)/).default("mailto:uacc@localhost") }).default({}),
  /** T7.9 (ADR-0024): System-1 gatekeeper for tool requests. The rules
   * always run; `model` adds a local llama.cpp judgement (OpenAI API). */
  gatekeeper: z
    .object({
      enabled: z.boolean().default(true),
      model: z
        .object({
          url: z.string().url(),
          model: z.string().min(1).default("qwen3-coder"),
          /** File with the API key (first line) — not in the config. */
          apiKeyFile: z.string().optional(),
        })
        .optional(),
      timeoutMs: z.number().int().min(500).max(60_000).default(8000),
      minConfidence: z.number().min(0).max(1).default(0.8),
    })
    .default({}),
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
  /** T4.1 (EPIC-P4 §3 "Brain-Digest") / ADR-0009: fire-and-forget digest
   * consumers, one call per completed session. Empty by default — no
   * digests, no new network egress unless explicitly configured (same
   * "default off" principle as the MCP gateway, OD-2). */
  reportingSinks: z.array(ReportingSinkRegistration).default([]),
  /**
   * T5.3 / ADR-0012: optional overrides for read-only session scans.
   * Omitted paths use ~/.claude and the Cursor user dir when those
   * directories exist. A set path that is missing stays visible as
   * unsupported-format instead of being skipped.
   */
  discovery: z
    .object({
      claudeDir: z.string().min(1).optional(),
      cursorUserDir: z.string().min(1).optional(),
      opencodeDataDir: z.string().min(1).optional(),
    })
    .default({}),
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

/** T4.1: loads every enabled reporting-sink module and calls its
 * `createSink(config?)` factory. A misbehaving sink module fails loud at
 * startup (same as a misconfigured adapter) rather than silently
 * producing zero sinks — the operator explicitly opted into this via
 * config, so a typo'd module path should be visible immediately, not
 * discovered later as "digests never arrive". */
export async function loadReportingSinks(
  registrations: ReportingSinkRegistration[],
  configPath: string,
): Promise<ReportingSink[]> {
  const sinks: ReportingSink[] = [];
  for (const reg of registrations) {
    if (!reg.enabled) continue;
    const spec = await resolveAdapterModule(reg.module, configPath);
    const mod = (await import(spec)) as { createSink?: (config?: Record<string, unknown>) => ReportingSink };
    if (typeof mod.createSink !== "function") {
      throw new Error(`reporting sink module "${reg.module}" does not export createSink(config?) => ReportingSink`);
    }
    sinks.push(mod.createSink(reg.config));
  }
  return sinks;
}
