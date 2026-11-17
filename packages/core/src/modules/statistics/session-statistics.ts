import type { SessionStatistics } from "@ancientvoid/contracts";
import { statisticsDistribution } from "./distribution.ts";
import type { SessionFacts } from "./session-facts.ts";

/** P56 T56.1b: Gruppe je belegter Adapter-/Modell-ID; `null`-Modell ist eigener Bucket. */
export function aggregateSessionStatistics(input: readonly SessionFacts[]): SessionStatistics[] {
  const seen = new Set<string>();
  const groups = new Map<string, SessionFacts[]>();
  for (const facts of input) {
    if (seen.has(facts.sessionId)) throw new Error("Duplicate session identity in statistics input.");
    seen.add(facts.sessionId);
    const key = JSON.stringify([facts.adapter, facts.model]);
    const group = groups.get(key) ?? [];
    group.push(facts);
    groups.set(key, group);
  }
  return [...groups.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, sessions]) => ({
    adapter: sessions[0]!.adapter,
    model: sessions[0]!.model,
    sessions: sessions.length,
    openSessions: sessions.filter(s => s.endReason === null).length,
    endReasons: {
      completed: sessions.filter(s => s.endReason === "completed").length,
      error: sessions.filter(s => s.endReason === "error").length,
      interrupted: sessions.filter(s => s.endReason === "interrupted").length,
      stopped: sessions.filter(s => s.endReason === "stopped").length,
    },
    wallMs: statisticsDistribution(sessions.map(s => s.wallMs)),
    activeMs: statisticsDistribution(sessions.map(s => s.activeMs)),
    turnsPerSession: statisticsDistribution(sessions.map(s => s.turns)),
  }));
}
