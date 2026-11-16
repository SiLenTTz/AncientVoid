import type { NormalizedEvent, TurnMetric } from "@ancientvoid/contracts";

interface Identity {
  sessionId: string;
  adapter: string;
  model: string | null;
}

const isTurnEnd = (e: NormalizedEvent): boolean => e.type === "system" && (e.payload as { kind?: unknown }).kind === "session.turn_end";

/** A turn runs from the first event after the previous `session.turn_end` to its own `session.turn_end`. */
export function deriveTurnMetrics(events: readonly NormalizedEvent[], who: Identity): TurnMetric[] {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const turns: TurnMetric[] = [];
  let first: NormalizedEvent | undefined;
  let count = 0;
  let tools = 0;
  let tokens: number | null = null;
  let source: "native" | "estimated" | null = null;
  let cost: number | null = null;
  let failed = false;
  for (const e of sorted) {
    if (isTurnEnd(e)) {
      if (first) {
        const started = Date.parse(first.ts);
        const ended = Date.parse(e.ts);
        if (Number.isFinite(started) && Number.isFinite(ended)) {
          const code = (e.payload as { code?: unknown }).code;
          turns.push({
            sessionId: who.sessionId,
            turn: turns.length + 1,
            adapter: who.adapter,
            model: who.model,
            startedAt: first.ts,
            endedAt: e.ts,
            durationMs: Math.max(0, ended - started),
            tokens,
            tokensSource: source,
            costUsd: cost,
            events: count,
            toolCalls: tools,
            outcome: failed || e.payload.reason === "interrupted" || e.payload.reason === "error" || (typeof code === "number" && code !== 0) ? "error" : "ok",
          });
        }
      }
      first = undefined;
      count = 0;
      tools = 0;
      tokens = null;
      source = null;
      cost = null;
      failed = false;
      continue;
    }
    first ??= e;
    count++;
    if (e.type === "tool_use") tools++;
    if (e.type === "error") failed = true;
    if (typeof e.tokensEst === "number") {
      tokens = (tokens ?? 0) + e.tokensEst;
      // estimated wins: one estimated event makes the sum an estimate.
      source = e.tokensSource === "estimated" || source === "estimated" ? "estimated" : "native";
    }
    if (typeof e.costUsd === "number") cost = (cost ?? 0) + e.costUsd;
  }
  return turns;
}
