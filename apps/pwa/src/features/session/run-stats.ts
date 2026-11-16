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
    // Auch laufend: der Balken zeigt die letzte gemeldete Füllung, nicht
    // erst ab dem ersten beendeten Zug (sonst „unbekannt" mitten im Zug,
    // obwohl der Provider Zahlen geschickt hat).
    if (input !== null) {
      context = input;
      lastContext = input;
    }
    if (e.type === "system" && (e.payload as { kind?: unknown }).kind === "session.turn_end") {
      turns.push({ endSeq: e.seq, tokens, contextTokens: context });
      tokens = 0;
    }
  }
  return { turns, lastContextTokens: lastContext };
}

/** Zwei reale Formate: die meisten Adapter melden `usage.input` (claude,
 * cursor, acp, pi), codex exec hingegen `usage.inputTokens` (camelCase,
 * aus seinem normalizedUsage) — beide sind eine gemeldete Füllung. */
function usageInput(e: NormalizedEvent): number | null {
  const usage = (e.payload as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return null;
  const input = (usage as { input?: unknown }).input;
  if (typeof input === "number") return input;
  const inputTokens = (usage as { inputTokens?: unknown }).inputTokens;
  return typeof inputTokens === "number" ? inputTokens : null;
}

/** Turns that closed between two visible events — the row a filtered list
 * (Chat hides session.turn_end) still needs under the turn's last row. */
export function turnsClosedBetween(turns: readonly TurnStats[], prevSeq: number, nextSeq: number | null): TurnStats[] {
  return turns.filter((t) => t.endSeq > prevSeq && (nextSeq === null || t.endSeq < nextSeq));
}

/** Die Modell-Ansagen der Adapter, die eines dieser Events emitieren —
 * Cursor gehört dazu: adapter-cursor meldet `cursor.model` mit echter
 * Fenstergröße (contextWindowFor), derselbe Vertrag wie acp/pi/opencode. */
const MODEL_EVENT_KINDS = ["acp.model", "opencode.model", "pi.model", "cursor.model"] as const;

/** Die session's current model is its LATEST announce — its window or none.
 * An older model's window is not this model's window, so it never shines
 * through. */
export function contextWindowFromEvents(events: readonly NormalizedEvent[]): number | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const payload = events[i]!.payload as { kind?: unknown; contextWindowTokens?: unknown };
    if ((MODEL_EVENT_KINDS as readonly string[]).includes(String(payload.kind))) {
      return typeof payload.contextWindowTokens === "number" ? payload.contextWindowTokens : null;
    }
  }
  return null;
}

/** Der zuletzt angekündigte Modellname (Kopfzeile der Session-Ansicht) —
 * dieselbe Event-Auswahl wie contextWindowFromEvents, damit Fenster und
 * Name nie aus zwei verschiedenen Ankündigungen stammen. */
export function latestModelName(events: readonly NormalizedEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const payload = events[i]!.payload as { kind?: unknown; model?: unknown };
    if ((MODEL_EVENT_KINDS as readonly string[]).includes(String(payload.kind)) && typeof payload.model === "string" && payload.model) {
      return payload.model;
    }
  }
  return null;
}

const fmt = new Intl.NumberFormat("de-DE");

/** One honest sentence about the context window (ADR-0032): a percentage
 * and the free room only from two real numbers; a missing number is said,
 * not hidden (fail loud). */
export function contextText(fill: number | null, windowTokens: number | null): string {
  if (fill === null) return "Kontext unbekannt";
  if (windowTokens === null || windowTokens <= 0) return `Kontext ${fmt.format(fill)} Tokens · Fenstergröße unbekannt`;
  const pct = Math.round((fill / windowTokens) * 100);
  return `Kontext ${pct} % · frei ${fmt.format(Math.max(0, windowTokens - fill))} von ${fmt.format(windowTokens)}`;
}

/** The session's token sum, or that nobody reported one. */
export function tokenText(known: boolean, total: number): string {
  return known ? `Σ ${fmt.format(total)} Tokens` : "Tokens unbekannt";
}

/** Context level for styling — warn from 80 %, err from 95 %. */
export function contextLevel(fill: number | null, windowTokens: number | null): "warn" | "err" | null {
  if (fill === null || windowTokens === null || windowTokens <= 0) return null;
  const pct = fill / windowTokens;
  if (pct >= 0.95) return "err";
  if (pct >= 0.8) return "warn";
  return null;
}
