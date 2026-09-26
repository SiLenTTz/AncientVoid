import type { NormalizedEvent } from "../../shared/ws.ts";

/**
 * ADR-0032: token numbers per turn and the context fill, both read from
 * the event stream — `tokensEst` summed per turn, the context fill is the
 * last `payload.usage.input` a turn saw (the request carries the whole
 * history, so its input IS how full the window was).
 */
export interface TurnStats {
  /** Seq of the turn's `session.turn_end`. */
  endSeq: number;
  /** Summed tokensEst of the turn. */
  tokens: number;
  /** Last reported context fill of the turn, in tokens. */
  contextTokens: number | null;
}

export interface SessionTokenStats {
  turns: TurnStats[];
  lastContextTokens: number | null;
}

export function turnTokenStats(events: readonly NormalizedEvent[]): SessionTokenStats {
  const turns: TurnStats[] = [];
  let tokens = 0;
  let context: number | null = null;
  let lastContext: number | null = null;
  for (const e of events) {
    if (typeof e.tokensEst === "number") tokens += e.tokensEst;
    const input = usageInput(e);
    if (input !== null) context = input;
    if (e.type === "system" && (e.payload as { kind?: unknown }).kind === "session.turn_end") {
      turns.push({ endSeq: e.seq, tokens, contextTokens: context });
      lastContext = context ?? lastContext;
      tokens = 0;
    }
  }
  return { turns, lastContextTokens: lastContext };
}

function usageInput(e: NormalizedEvent): number | null {
  const usage = (e.payload as { usage?: unknown }).usage;
  const input = (usage as { input?: unknown } | null)?.input;
  return typeof input === "number" ? input : null;
}

/** Turns that closed between two visible events — the row a filtered list
 * (Chat hides session.turn_end) still needs under the turn's last row. */
export function turnsClosedBetween(turns: readonly TurnStats[], prevSeq: number, nextSeq: number | null): TurnStats[] {
  return turns.filter((t) => t.endSeq > prevSeq && (nextSeq === null || t.endSeq < nextSeq));
}

const fmt = new Intl.NumberFormat("de-DE");

/** One honest sentence about the context window (ADR-0032): a percentage
 * only from two real numbers; a fill without a window names no percentage. */
export function contextText(fill: number | null, windowTokens: number | null): string | null {
  if (fill === null) return null;
  if (windowTokens === null || windowTokens <= 0) return `Kontext ${fmt.format(fill)} Tokens`;
  const pct = Math.round((fill / windowTokens) * 100);
  return `Kontext ${pct} % (${fmt.format(fill)} / ${fmt.format(windowTokens)})`;
}

/** Context level for styling — warn from 80 %, err from 95 %. */
export function contextLevel(fill: number | null, windowTokens: number | null): "warn" | "err" | null {
  if (fill === null || windowTokens === null || windowTokens <= 0) return null;
  const pct = fill / windowTokens;
  if (pct >= 0.95) return "err";
  if (pct >= 0.8) return "warn";
  return null;
}
