import { TurnMetric, type TurnStatistics } from "@ancientvoid/contracts";
import { statisticsDistribution } from "./distribution.ts";

/** P56: alle Ergebnisse zählen, anders als bei einer Laufzeitprognose. */
export function aggregateTurnStatistics(input: readonly TurnMetric[]): TurnStatistics[] {
  const seen = new Set<string>();
  const groups = new Map<string, TurnMetric[]>();
  for (const raw of input) {
    const turn = TurnMetric.parse(raw);
    const identity = JSON.stringify([turn.sessionId, turn.turn]);
    if (seen.has(identity)) throw new Error("Duplicate turn identity in statistics input.");
    seen.add(identity);
    if ((turn.tokens === null) !== (turn.tokensSource === null)) throw new Error("Tokenwert und Herkunft widersprechen sich.");
    const key = JSON.stringify([turn.adapter, turn.model]);
    const group = groups.get(key) ?? [];
    group.push(turn);
    groups.set(key, group);
  }
  return [...groups.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, turns]) => ({
    adapter: turns[0]!.adapter,
    model: turns[0]!.model,
    turns: turns.length,
    failedTurns: turns.filter(t => t.outcome === "error").length,
    durationMs: statisticsDistribution(turns.map(t => t.durationMs)),
    tokens: statisticsDistribution(turns.map(t => t.tokens)),
    estimatedTokenTurns: turns.filter(t => t.tokensSource === "estimated").length,
  }));
}
