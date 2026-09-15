import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * T1.5-8 — prompt enhancer. Design decision (EPIC-P1.5 §3.4), made with
 * real measurements, not a guess:
 *
 *   (a) the currently-selected coding adapter itself, via a quick
 *       throwaway call — CHOSEN.
 *   (b) a separate local model — REJECTED for now: no such infrastructure
 *       exists anywhere in this repo (P3 §3 envisioned a local
 *       Qwen fine-tune that was never built), so there is nothing to
 *       measure it against. (a) is the only option with a real number
 *       behind it today.
 *
 * Real measurement, claude (2026-09-16, this session, claude-sonnet-5,
 * `claude -p ... --output-format json --tools "" --dangerously-skip-permissions`):
 * 6617ms wall time, $0.065402 for one rewrite of a short raw prompt. That
 * is a real, non-trivial quota cost per click — which is exactly why the
 * result carries its own cost/latency back to the caller instead of
 * silently succeeding. It is NOT folded into ADR-0004's per-adapter usage
 * cache: doing so would require running this one-shot call through the
 * full streaming adapter pipeline (stream-json + normalize.ts's
 * rate_limit_event parsing) that a lightweight utility call doesn't
 * otherwise need — claude's non-streaming `--output-format json` (used
 * here for simplicity) doesn't even carry a rate_limit_event at all, only
 * the streaming format does. Shown at the point of use instead (T1.5-8's
 * UI), a deliberate scope line, not a silent gap.
 *
 * codex: attempted the same real measurement on 2026-09-16 and hit a real
 * "you've hit your usage limit" account-level error (itself a genuine,
 * unplanned demonstration of exactly the quota-exhaustion scenario
 * ADR-0004 exists to surface) — no real codex latency/cost number exists
 * yet. The code path below is implemented identically in spirit (same
 * CLI, same one-shot pattern) and ready to verify once quota is
 * available; per R9.7, no cost is invented for codex regardless (it has
 * no native cost figure at all, T1.11).
 */

const INSTRUCTION =
  "Rewrite the user's raw instruction below into a well-structured coding-agent prompt with exactly these sections: Ziel, Scope, Constraints, Erfolgskriterium. Keep it concise. Output ONLY the rewritten prompt text, no preamble, no explanation, no markdown code fences.";

export interface EnhanceResult {
  enhanced: string;
  /** Real cost of this one call, when the adapter reports one (claude
   * does; codex doesn't — R9.7, never guessed). */
  costUsd?: number;
  latencyMs: number;
}

const TIMEOUT_MS = 30_000;
const MAX_BUFFER = 1024 * 1024;

/**
 * Pure parsing, split out from the subprocess call specifically so it's
 * unit-testable against real captured output (this repo's own
 * ground-truth-over-mocking convention, T1.2/T1.3) without spawning a
 * real, paid CLI call on every test run.
 */
export function parseClaudeEnhanceOutput(stdout: string): Omit<EnhanceResult, "latencyMs"> {
  const parsed = JSON.parse(stdout) as { result?: string; total_cost_usd?: number };
  return {
    enhanced: (parsed.result ?? "").trim(),
    ...(typeof parsed.total_cost_usd === "number" ? { costUsd: parsed.total_cost_usd } : {}),
  };
}

export function parseCodexEnhanceOutput(stdout: string): Omit<EnhanceResult, "latencyMs"> {
  let enhanced = "";
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line) as { type?: string; item?: { type?: string; text?: string } };
      if (obj.type === "item.completed" && obj.item?.type === "agent_message") {
        enhanced = obj.item.text ?? "";
      }
    } catch {
      // non-JSON line — ignore, matches the adapters' own fail-loud-but-
      // don't-crash handling of unexpected stream content.
    }
  }
  // No costUsd here — codex has no native cost figure (T1.11), never guessed.
  return { enhanced: enhanced.trim() };
}

async function enhanceViaClaude(rawText: string, cwd: string): Promise<EnhanceResult> {
  const start = Date.now();
  const { stdout } = await execFileAsync(
    "claude",
    [
      "-p",
      `${INSTRUCTION}\n\n---\n${rawText}`,
      "--output-format",
      "json",
      "--tools",
      "",
      "--dangerously-skip-permissions",
    ],
    { timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, cwd },
  );
  return { ...parseClaudeEnhanceOutput(stdout), latencyMs: Date.now() - start };
}

async function enhanceViaCodex(rawText: string, cwd: string): Promise<EnhanceResult> {
  const start = Date.now();
  const { stdout } = await execFileAsync(
    "codex",
    ["exec", `${INSTRUCTION}\n\n${rawText}`, "--json", "--skip-git-repo-check", "--sandbox", "read-only"],
    { timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, cwd },
  );
  return { ...parseCodexEnhanceOutput(stdout), latencyMs: Date.now() - start };
}

/**
 * `project` sets the CLI's cwd — found necessary via a real end-to-end
 * test: without it, the call ran in the *hub server's own* working
 * directory (wherever `main.ts` happened to be started from), so the
 * "enhanced" prompt reflected the hub's own repo instead of whatever
 * project the user actually selected. The caller is responsible for the
 * same containment check used for session creation (isProjectPathAllowed,
 * routes.ts) — this function trusts the path it's given.
 */
export async function enhancePrompt(adapterId: string, rawText: string, project: string): Promise<EnhanceResult> {
  if (adapterId === "claude") return enhanceViaClaude(rawText, project);
  if (adapterId === "codex") return enhanceViaCodex(rawText, project);
  throw new Error(`enhancePrompt: no enhancer wired up for adapter "${adapterId}"`);
}
