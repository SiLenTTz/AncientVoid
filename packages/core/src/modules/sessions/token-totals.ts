import type { NormalizedEvent } from "@ancientvoid/contracts";

/**
 * ADR-0084: die Token-Bilanz einer Session, abgeleitet aus dem EventStore.
 *
 * Zwei Zahlen, weil es zwei verschiedene Dinge sind:
 *  * `generated` — Tokens, die das Modell **geschrieben** hat (Ausgabe, bei
 *    Reasoning-Adaptern inklusive Reasoning-Anteil).
 *  * `processed` — Tokens, die die Aufrufe **bekommen haben** (die pro Ereignis
 *    gemeldete Größe, ADR-0006). Jeder Aufruf schickt den ganzen Verlauf, diese
 *    Zahl wächst deshalb ~linear mit der Zahl der Aufrufe mal Kontext. Sie als
 *    „Σ Tokens“ zu zeigen war BUG-0182.
 *
 * Es gibt dafür keine Spalte und keinen neuen Zustand: die Werte sind jederzeit
 * aus JSONL nachrechenbar (K7). Ein Zähler ist bewusst inkrementell gebaut, damit
 * große Sessions seitenweise gelesen werden können, ohne sie zu sammeln.
 */
export interface SessionTokenTotals {
  /** Summe der Ausgabe-Tokens; null = niemand hat je eine Ausgabe gemeldet. */
  generated: number | null;
  /** Summe der gemeldeten Aufrufgrößen; null = nichts gemeldet (nicht 0). */
  processed: number | null;
  /** Kontextfüllung des letzten gemeldeten Aufrufs (ADR-0032), null = unbekannt. */
  contextFill: number | null;
  /** Davon aus dem Cache gelesen; null, wenn der Adapter Cache nicht trennt. */
  cacheRead: number | null;
  /** Wie viele Ereignisse Zahlen trugen. */
  usageEvents: number;
  /** true, wenn mindestens ein Wert eine Schätzung war (T7.7). */
  estimated: boolean;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Zahlen, die ein Ereignis meldet — null, wenn das Ereignis gar nichts meldet. */
interface Reported {
  est: number | null;
  output: number | null;
  input: number | null;
  cacheRead: number | null;
}

/**
 * Die Adapter melden die Provider-Form, nicht eine hub-eigene (ADR-0084):
 * pi und cursor `usage.input/output`, codex `usage.inputTokens/outputTokens/
 * reasoningOutputTokens/cachedInputTokens`, claude und cursor-Rohdaten
 * `input_tokens/output_tokens`. Die Übersetzung liegt hier, nicht in Adaptern.
 */
function reportedOf(e: NormalizedEvent): Reported {
  const raw = (e.payload as { usage?: unknown } | undefined)?.usage;
  const u = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const one = (...keys: string[]): number | null => {
    for (const k of keys) {
      const v = num(u[k]);
      if (v !== null) return v;
    }
    return null;
  };
  // Reasoning-Tokens sind erzeugte Tokens (das Denken steht im Verlauf).
  const plain = one("output", "outputTokens", "output_tokens");
  const reasoning = one("reasoningOutput", "reasoningOutputTokens", "reasoning_output_tokens");
  return {
    est: num(e.tokensEst ?? null),
    output: plain === null && reasoning === null ? null : (plain ?? 0) + (reasoning ?? 0),
    input: one("input", "inputTokens", "input_tokens"),
    cacheRead: one("cacheRead", "cachedInputTokens", "cache_read", "cached_input_tokens"),
  };
}

/** Zähler über Ereignis-Seiten; Reihenfolge egal, `contextFill` folgt der letzten
 * Meldung in durchlaufener Reihenfolge. */
export interface TokenTally {
  add(events: readonly NormalizedEvent[]): void;
  result(): SessionTokenTotals;
}

export function createTokenTally(): TokenTally {
  let generated: number | null = null;
  let processed: number | null = null;
  let contextFill: number | null = null;
  let cacheRead: number | null = null;
  let usageEvents = 0;
  let estimated = false;
  return {
    add(events) {
      for (const e of events) {
        const r = reportedOf(e);
        if (e.tokensSource === "estimated") estimated = true;
        if (r.est === null && r.output === null && r.input === null && r.cacheRead === null) continue;
        usageEvents += 1;
        if (r.est !== null) processed = (processed ?? 0) + r.est;
        if (r.output !== null) generated = (generated ?? 0) + r.output;
        if (r.input !== null) contextFill = r.input;
        if (r.cacheRead !== null) cacheRead = (cacheRead ?? 0) + r.cacheRead;
      }
    },
    result: () => ({ generated, processed, contextFill, cacheRead, usageEvents, estimated }),
  };
}

/** Einmalige Auswertung einer Ereignisliste (Tests, kleine Sessions). */
export function tokenTotalsOf(events: readonly NormalizedEvent[]): SessionTokenTotals {
  const tally = createTokenTally();
  tally.add(events);
  return tally.result();
}
