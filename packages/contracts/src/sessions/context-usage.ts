/** ADR-0099: a per-request context report outranks the cumulative usage of
 * the same turn. Older adapters still expose their input count as a fallback. */
export function createContextUsageReader(): (payload: Readonly<Record<string, unknown>>) => number | null {
  let precise = false;
  return (payload) => {
    if (typeof payload.contextInputTokens === "number" && Number.isSafeInteger(payload.contextInputTokens) && payload.contextInputTokens >= 0) {
      precise = true;
      return payload.contextInputTokens;
    }
    if (payload.kind === "claude.result" || payload.kind === "acp.turn_end") {
      const hadReport = precise;
      precise = false;
      if (hadReport) return null;
    }
    if (typeof payload.usage !== "object" || payload.usage === null) return null;
    const usage = payload.usage as Record<string, unknown>;
    const input = usage.input ?? usage.inputTokens ?? usage.input_tokens;
    return typeof input === "number" && Number.isFinite(input) ? input : null;
  };
}
