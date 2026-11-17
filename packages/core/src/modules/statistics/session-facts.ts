import { type NormalizedEvent, type SessionEndReason } from "@ancientvoid/contracts";
import { deriveTurnMetrics } from "../runs/index.ts";

export interface Identity {
  sessionId: string;
  adapter: string;
  model: string | null;
}

/**
 * P56 T56.1b: Journal-Fakten einer Session. `endReason` klassifiziert den
 * letzten terminalen Marker; ob die Session beendet war, entscheidet erst
 * die Rollup-Auswahl (T56.2) anhand SessionRecord.status.
 */
export interface SessionFacts {
  sessionId: string;
  adapter: string;
  model: string | null;
  /** Erster bis letzter Event-Zeitstempel; null nur ohne jedes Event. */
  wallMs: number | null;
  /** Summe beendeter Zug-Intervalle — ein offener Zug zählt nicht. */
  activeMs: number;
  turns: number;
  /** Letzter Zug ohne session.turn_end — activeMs ist dann zwangsläufig unvollständig. */
  openTurn: boolean;
  endReason: SessionEndReason | null;
}

/** Belegte Recovery: Unterbrechung bis zum nächsten erfolgreich beendeten Zug. */
export interface RecoveryInterval {
  sessionId: string;
  interruptedAt: string;
  recoveredAt: string | null;
  recoveryMs: number | null;
}

const kindOf = (e: NormalizedEvent): unknown => (e.payload as { kind?: unknown }).kind;

const isTurnEnd = (e: NormalizedEvent): boolean => e.type === "system" && kindOf(e) === "session.turn_end";
const isStopped = (e: NormalizedEvent): boolean => e.type === "system" && kindOf(e) === "session.stopped";
const isInterrupted = (e: NormalizedEvent): boolean => e.type === "system" && kindOf(e) === "session.interrupted";

/** Klassifikation wie bei TurnMetric.outcome: code !== 0 oder reason error/interrupted sind Fehler-/Unterbrechungsbelege. */
const turnEndReason = (e: NormalizedEvent): SessionEndReason => {
  const { reason, code } = e.payload as { reason?: unknown; code?: unknown };
  if (reason === "error") return "error";
  if (reason === "interrupted") return "interrupted";
  if (typeof code === "number" && code !== 0) return "error";
  return "completed";
};

export function deriveSessionFacts(events: readonly NormalizedEvent[], who: Identity): SessionFacts | null {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  if (sorted.length === 0) return null;
  const turns = deriveTurnMetrics(sorted, who);
  const first = Date.parse(sorted[0]!.ts);
  const last = Date.parse(sorted[sorted.length - 1]!.ts);
  const wallMs = Number.isFinite(first) && Number.isFinite(last) ? Math.max(0, last - first) : null;
  let endReason: SessionEndReason | null = null;
  for (const e of sorted) {
    if (isTurnEnd(e)) endReason = turnEndReason(e);
    else if (isStopped(e)) endReason = "stopped";
  }
  const lastTurnEnd = sorted.findLastIndex(isTurnEnd);
  const openTurn = sorted.slice(lastTurnEnd + 1).some(e => !isStopped(e) && !isInterrupted(e));
  return {
    sessionId: who.sessionId,
    adapter: who.adapter,
    model: who.model,
    wallMs,
    activeMs: turns.reduce((sum, t) => sum + t.durationMs, 0),
    turns: turns.length,
    openTurn,
    endReason,
  };
}

/**
 * Recovery-Zeit je `session.interrupted`: bis zum nächsten beendeten Zug,
 * der weder der Unterbrechungsabschluss selbst (`reason: "interrupted"`)
 * noch fehlerhaft ist und vor einer weiteren Unterbrechung liegt.
 * Ohne solchen Weiterlauf bleibt recoveryMs null — nicht geraten.
 */
export function deriveRecoveryIntervals(events: readonly NormalizedEvent[], sessionId: string): RecoveryInterval[] {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const intervals: RecoveryInterval[] = [];
  let pending: { at: string; ts: number } | null = null;
  for (const e of sorted) {
    if (isInterrupted(e)) {
      if (pending) intervals.push({ sessionId, interruptedAt: pending.at, recoveredAt: null, recoveryMs: null });
      const ts = Date.parse(e.ts);
      pending = Number.isFinite(ts) ? { at: e.ts, ts } : null;
      continue;
    }
    if (pending && isTurnEnd(e) && turnEndReason(e) === "completed") {
      const recovered = Date.parse(e.ts);
      intervals.push(Number.isFinite(recovered)
        ? { sessionId, interruptedAt: pending.at, recoveredAt: e.ts, recoveryMs: Math.max(0, recovered - pending.ts) }
        : { sessionId, interruptedAt: pending.at, recoveredAt: null, recoveryMs: null });
      pending = null;
    }
  }
  if (pending) intervals.push({ sessionId, interruptedAt: pending.at, recoveredAt: null, recoveryMs: null });
  return intervals;
}
