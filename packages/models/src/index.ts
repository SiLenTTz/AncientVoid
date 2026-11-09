/**
 * ADR-0032: context window sizes per model. No harness reports the window
 * in band — this table is the curated fallback, and an adapter config
 * (`contextWindows`, matched first) can override or extend it.
 *
 * Source: models.dev API (the same database opencode's own model catalog
 * uses), retrieved 2026-09-26. Every entry was looked up per provider
 * there; models not listed there stay unknown (null) — never guessed.
 * Matching is substring on the lowercased model id, most specific rule
 * first; a `provider/model` id matches by its model part.
 */

/** [substring-of-model-id, context window tokens] — first hit wins. */
const RULES: readonly (readonly [string, number])[] = [
  // Zhipu/ZAI (glm) — via zai-coding-plan and friends.
  ["glm-4.7", 204_800],
  ["glm-5-turbo", 200_000],
  ["glm-5.1", 200_000],
  ["glm-5v", 200_000],
  ["glm-5.2", 1_000_000],
  ["glm-5.3", 1_000_000],
  ["glm-5", 204_800],
  // OpenCode Zen (opencode/*), incl. the free/stealth tier.
  ["big-pickle", 200_000],
  ["space-bunny-free", 1_048_576],
  ["longcat-2.5", 1_000_000],
  ["mimo-v2", 200_000],
  ["ling-3.0", 262_144],
  ["muse-spark", 1_048_576],
  ["nemotron-3-ultra", 1_000_000],
  ["nemotron-3.5-lightning", 262_144],
  // Anthropic (claude-* via Zen or direct).
  ["claude-haiku", 200_000],
  ["claude-sonnet-4-5", 1_000_000],
  ["claude-sonnet-4-6", 1_000_000],
  ["claude-sonnet-5", 1_000_000],
  ["claude-opus-4-5", 1_000_000],
  ["claude-opus-4-6", 1_000_000],
  ["claude-opus-4-7", 1_000_000],
  ["claude-opus-4-8", 1_000_000],
  ["claude-opus-5", 1_000_000],
  ["claude-fable", 1_000_000],
  // OpenAI.
  ["gpt-6", 1_050_000],
  ["gpt-5.5", 1_050_000],
  ["gpt-5.3-codex-spark", 128_000],
  ["gpt-5.3-codex", 400_000],
  // xAI.
  ["grok-4", 500_000],
  // Google.
  ["gemini-3", 1_048_576],
  // DeepSeek.
  ["deepseek-v4-pro", 1_000_000],
  ["deepseek-v4.1-flash", 1_000_000],
  // Moonshot Kimi.
  ["kimi-k3", 1_048_576],
  ["kimi-k2.7-code", 262_144],
  // MiniMax.
  ["minimax-m3", 1_000_000],
  // Alibaba Qwen.
  ["qwen3.8", 1_000_000],
];

function lookup(rules: readonly (readonly [string, number])[], id: string): number | null {
  const model = id.toLowerCase().split("/").pop() ?? id.toLowerCase();
  for (const [needle, window] of rules) {
    if (model.includes(needle) || id.toLowerCase().includes(needle)) return window;
  }
  return null;
}

/** The curated context window for a model id — null when unknown. */
export function contextWindowFor(modelId: string): number | null {
  return lookup(RULES, modelId);
}

/**
 * Config overrides first (an adapter's `contextWindows` record, matched by
 * the same substring rule), then the curated table. Keys match the wanted
 * model name AND the raw provider value (some agents answer with a JSON
 * pair like `["lokal","glm-5.3"]`).
 */
export function resolveContextWindow(modelId: string, rawValue: string | undefined, overrides: Readonly<Record<string, number>>): number | null {
  const custom = Object.entries(overrides);
  if (custom.length > 0) {
    const keys = [modelId, ...(rawValue !== undefined ? [rawValue] : [])];
    for (const [needle, window] of custom) {
      if (keys.some((k) => k.toLowerCase().includes(needle.toLowerCase()))) return window;
    }
  }
  return contextWindowFor(modelId) ?? (rawValue !== undefined ? contextWindowFor(rawValue) : null);
}

/**
 * ADR-0054 (EPIC-P35 T35.7): a model catalog from a listing command — the
 * config-driven source every adapter shares. One model per line, either
 * `provider/model` or a bare id; an optional label follows a tab. Anything
 * else (warnings, headers, empty lines) is skipped, never guessed into a model.
 */
export interface ListedModel {
  id: string;
  label?: string;
}

const MODEL_LINE = /^[\w@:.-]+(?:\/[\w@:.-]+)?$/;

export function parseModelLines(stdout: string): ListedModel[] {
  const out: ListedModel[] = [];
  const seen = new Set<string>();
  for (const raw of stdout.split("\n")) {
    const [idPart, labelPart] = raw.split("\t");
    const id = (idPart ?? "").trim();
    if (!id || id.startsWith("#") || !MODEL_LINE.test(id) || seen.has(id)) continue;
    seen.add(id);
    const label = labelPart?.trim();
    out.push(label ? { id, label } : { id });
  }
  return out;
}

/**
 * `pi --list-models` prints a table: `provider  model  context  max-out  thinking  images`
 * (live 2026-11-09, pi 1.4.0). Rows become `provider/model`; the header, warnings and
 * anything that is not two bare tokens stay out — an unknown shape yields no models, never guesses.
 */
export function parseModelTable(stdout: string): ListedModel[] {
  const out: ListedModel[] = [];
  const seen = new Set<string>();
  const cell = /^[\w@:.+-]+$/;
  const lines = stdout.split("\n").map((l) => l.trim().split(/\s+/));
  const header = lines[0];
  if (header?.[0] !== "provider" || header[1] !== "model") return out;
  for (const [provider, model, context] of lines.slice(1)) {
    if (!provider || !model || !cell.test(provider) || !cell.test(model)) continue;
    const id = `${provider}/${model}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(context && /^[\d.]+[KM]?$/i.test(context) ? { id, label: `${id} · ${context} Kontext` } : { id });
  }
  return out;
}

/** Runs the listing command read-only (no worker, no session, no cost) and
 * parses its stdout. Errors propagate visibly — an empty list must be the
 * command's honest answer, never a swallowed failure. */
export async function modelsFromCommand(
  command: readonly string[],
  opts: { env?: Readonly<Record<string, string>>; timeoutMs?: number; parse?: (stdout: string) => ListedModel[] } = {},
): Promise<ListedModel[]> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const [cmd, ...args] = command;
  if (!cmd) throw new Error("modelsFromCommand: leeres Kommando");
  const { stdout } = await run(cmd, args, {
    timeout: opts.timeoutMs ?? 20_000,
    maxBuffer: 1024 * 1024,
    ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}),
  });
  return (opts.parse ?? parseModelLines)(stdout);
}
