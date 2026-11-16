/**
 * T1.11 — codex's own price table (EPIC-P1 §4 T1.11, R9.7-Regel:
 * "unbekannt statt geraten"). codex-cli reports token usage (input/cached
 * input/output/reasoning) but never a native cost figure anywhere in its
 * `--json` stream (verified against real captures, see normalize.ts) — the
 * numbers below are AncientVoid's own estimate, not a value codex itself vouches
 * for.
 *
 * Source: https://developers.openai.com/api/docs/pricing (fetched
 * 2026-09-15, "Specialized models" / Codex section, "Standard" tier — not
 * "Fast mode", which AncientVoid's codex adapter never requests). Only
 * "gpt-5.3-codex" is listed there as of this date; no plain "gpt-5-codex"
 * entry exists any more (superseded). Prices in USD per 1,000,000 tokens.
 *
 * Add an entry here only against a real, dated, sourced price — never a
 * guess or an extrapolation from a different model's rate.
 */
interface CodexModelPricing {
  inputPerMTok: number;
  cachedInputPerMTok: number;
  outputPerMTok: number;
}

const CODEX_PRICING: Readonly<Record<string, CodexModelPricing>> = {
  "gpt-5.3-codex": { inputPerMTok: 1.75, cachedInputPerMTok: 0.175, outputPerMTok: 14.0 },
};

export interface CodexUsage {
  inputTokens?: number | undefined;
  cachedInputTokens?: number | undefined;
  outputTokens?: number | undefined;
  reasoningOutputTokens?: number | undefined;
}

/**
 * R9.7: returns `undefined` — never a guessed number, never a fallback to
 * another model's rate — whenever the model is unknown (session didn't
 * request one via `spec.model`, so codex used its own undocumented
 * default) or isn't in CODEX_PRICING (not yet priced here).
 *
 * `reasoningOutputTokens` is not billed separately: per OpenAI's public
 * usage-accounting convention (`usage.output_tokens_details.reasoning_tokens`
 * is a subset of `output_tokens`, not additional to it), reasoning tokens
 * are assumed already included in `outputTokens`. Unverified against this
 * specific CLI's own billing statement — every real capture so far had
 * `reasoning_output_tokens: 0` (see normalize.ts), so this assumption has
 * never actually been exercised by real data.
 */
export function estimateCostUsd(model: string | undefined, usage: CodexUsage): number | undefined {
  if (!model) return undefined;
  const price = CODEX_PRICING[model];
  if (!price) return undefined;
  const input = usage.inputTokens ?? 0;
  const cachedInput = usage.cachedInputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const uncachedInput = Math.max(0, input - cachedInput);
  return (
    (uncachedInput * price.inputPerMTok + cachedInput * price.cachedInputPerMTok + output * price.outputPerMTok) /
    1_000_000
  );
}
