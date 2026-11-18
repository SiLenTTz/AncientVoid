import { ToolStatistics, type NormalizedEvent } from "@ancientvoid/contracts";

/** P56 T56.1b: Ergebnisstand eines Tool-Aufrufs. */
export type ToolCallResult = "failed" | "ok" | "unknown" | null;

/** P56 T56.1b: ein Tool-Aufruf mit korreliertem Ergebnisstand. */
export interface ToolCallFact {
  sessionId: string;
  tool: string | null;
  /** null = kein korreliertes tool_result; "unknown" = Ergebnis ohne belegtes isError. */
  result: ToolCallResult;
}

export interface Identity {
  sessionId: string;
}

const callId = (payload: Record<string, unknown>): string | null => {
  const id = payload.id ?? payload.toolUseId;
  return typeof id === "string" && id.length > 0 ? id : null;
};

const toolName = (payload: Record<string, unknown>): string | null => {
  const name = payload.tool ?? payload.name;
  return typeof name === "string" && name.length > 0 ? name : null;
};

/**
 * Korrelation `tool_use.payload.id` ↔ `tool_result.payload.toolUseId`.
 * Replay zählt nicht doppelt: dieselbe Call-Id erneut im Journal ist der
 * gleiche Aufruf (Resume-Blöcke hängen historische Paare nochmal an, seq
 * bleibt monoton — BUG-0213), das erste Vorkommen gewinnt. Ein Ergebnis
 * ohne zuordenbaren Aufruf wird gezählt (Tool-Name/unbelegt-Zeile, Status
 * wie gemeldet), nie still verworfen und nie als Wurf: Ein einziges
 * solches Ereignis legt sonst die ganze Statistik-Seite lahm. K5: ist der
 * Ergebnis-Payload ausgelagert (`truncated`), steht die Call-Id nur im
 * Blob — das Ergebnis zählt dann als Aufruf mit unbekanntem Namen und
 * unbekanntem Fehlerstatus.
 * Tool-Name: `payload.tool` (opencode) oder `payload.name` (übrige Adapter);
 * fehlt beides, bleibt der Name unbekannt — nichts wird geraten.
 */
export function deriveToolCallFacts(events: readonly NormalizedEvent[], who: Identity): ToolCallFact[] {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const calls = new Map<string, ToolCallFact>();
  const order: string[] = [];
  const resultStatus = (payload: Record<string, unknown>): ToolCallResult => {
    const flag = (payload as { isError?: unknown }).isError;
    return flag === true ? "failed" : flag === false ? "ok" : "unknown";
  };
  for (const e of sorted) {
    if (e.type === "tool_use") {
      const id = callId(e.payload);
      if (id !== null && calls.has(id)) continue;
      const key = id ?? `seq:${e.seq}`;
      calls.set(key, { sessionId: who.sessionId, tool: toolName(e.payload), result: null });
      order.push(key);
      continue;
    }
    if (e.type === "tool_result") {
      const id = callId(e.payload);
      const status = resultStatus(e.payload);
      // Ohne Id (K5-ausgelagert) oder ohne Aufruf im Journal: als eigener
      // Fakt zählen — das Tool lief, nur die Zuordnung fehlt.
      if (id === null || !calls.has(id)) {
        const key = `res:${e.seq}`;
        calls.set(key, { sessionId: who.sessionId, tool: null, result: status });
        order.push(key);
        continue;
      }
      const call = calls.get(id)!;
      if (call.result === null) call.result = status;
    }
  }
  return order.map(key => calls.get(key)!);
}

/** Additive Zähl-Fakten je Tool — Grundlage für Cache (T56.2) und Summierung. */
export interface ToolCallCounts {
  calls: number;
  failed: number;
  ok: number;
  errorStatusUnknown: number;
  unanswered: number;
}

/** Baut die Statistik aus additiven Zählwerten; results wird mitgeführt geprüft. */
export function toolStatisticsOf(tool: string | null, counts: ToolCallCounts): ToolStatistics {
  const results = counts.failed + counts.ok + counts.errorStatusUnknown;
  return ToolStatistics.parse({
    tool,
    calls: counts.calls,
    results,
    failed: counts.failed,
    ok: counts.ok,
    errorStatusUnknown: counts.errorStatusUnknown,
    unanswered: counts.unanswered,
    failureRate: counts.failed + counts.ok === 0 ? null : counts.failed / (counts.failed + counts.ok),
  });
}

/** Gruppe je belegtem Tool-Namen; null = Name im Payload nicht belegt. */
export function aggregateToolStatistics(input: readonly ToolCallFact[]): ToolStatistics[] {
  const groups = new Map<string, ToolCallFact[]>();
  for (const fact of input) {
    const key = JSON.stringify([fact.tool]);
    const group = groups.get(key) ?? [];
    group.push(fact);
    groups.set(key, group);
  }
  return [...groups.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, calls]) =>
    toolStatisticsOf(calls[0]!.tool, {
      calls: calls.length,
      failed: calls.filter(c => c.result === "failed").length,
      ok: calls.filter(c => c.result === "ok").length,
      errorStatusUnknown: calls.filter(c => c.result === "unknown").length,
      unanswered: calls.filter(c => c.result === null).length,
    }),
  );
}
