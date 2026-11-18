import { describe, expect, it } from "vitest";
import { NormalizedEvent, ToolStatistics } from "@ancientvoid/contracts";
import { aggregateToolStatistics, deriveToolCallFacts } from "../../../src/modules/statistics/index.ts";

const event = (seq: number, patch: Record<string, unknown> = {}) => NormalizedEvent.parse({
  seq, ts: new Date("2026-11-15T10:00:00.000Z").toISOString(),
  sessionId: "s1", type: "tool_use", summary: "fixture", payload: {}, ...patch,
});

describe("P56 T56.1b Tool-Fakten", () => {
  it("korreliert Aufruf und Ergebnis über die Call-Id und liest den Namen aus tool oder name", () => {
    const facts = deriveToolCallFacts([
      event(1, { payload: { id: "t1", name: "Bash" } }),
      event(2, { type: "tool_result", payload: { toolUseId: "t1", isError: true } }),
      event(3, { payload: { id: "t2", tool: "read" } }),
      event(4, { payload: { id: "t3", input: {} } }),
      event(5, { type: "tool_result", payload: { toolUseId: "t3" } }),
    ], { sessionId: "s1" });
    expect(facts).toEqual([
      { sessionId: "s1", tool: "Bash", result: "failed" },
      { sessionId: "s1", tool: "read", result: null },
      { sessionId: "s1", tool: null, result: "unknown" },
    ]);
  });

  it("zählt Replay-Doppelungen und Korrelationsbrüche ehrlich, statt die Seite zu killen", () => {
    // BUG-0213: Journals enthalten legitimerweise beides — K5-ausgelagerte
    // tool_result-Payloads (truncated, ohne inline toolUseId) und Replay-
    // Blöcke nach Resume (dieselbe Call-Id nochmal, seq bleibt monoton).
    // Wer daraus einen Wurf macht, legt die ganze Statistik-Seite lahm.
    const facts = deriveToolCallFacts([
      // Replay: derselbe Aufruf nochmal — zählt nicht doppelt.
      event(1, { payload: { id: "t1", name: "Bash" } }),
      event(2, { payload: { id: "t1", name: "Bash" } }),
      event(3, { type: "tool_result", payload: { toolUseId: "t1", isError: false } }),
      // Replay des Ergebnisses: ebenfalls schon gezählt.
      event(4, { type: "tool_result", payload: { toolUseId: "t1", isError: false } }),
    ], { sessionId: "s1" });
    expect(facts).toEqual([
      { sessionId: "s1", tool: "Bash", result: "ok" },
    ]);

    // K5: ausgelagerter Payload — Zuordnung und isError liegen im Blob.
    const truncated = deriveToolCallFacts([
      event(1, { payload: { id: "t1", name: "Bash" } }),
      event(2, { type: "tool_result", payload: { truncated: true, bytes: 30703, preview: "…" } }),
    ], { sessionId: "s1" });
    expect(truncated).toEqual([
      { sessionId: "s1", tool: "Bash", result: null },
      { sessionId: "s1", tool: null, result: "unknown" },
    ]);

    // Ergebnis mit Id, deren Aufruf nicht im Journal steht: zählen, nicht werfen.
    const orphan = deriveToolCallFacts([
      event(1, { type: "tool_result", payload: { toolUseId: "t9", isError: true } }),
    ], { sessionId: "s1" });
    expect(orphan).toEqual([
      { sessionId: "s1", tool: null, result: "failed" },
    ]);
  });
});

describe("P56 T56.1b Tool-Aggregation", () => {
  const fact = (tool: string | null, result: "failed" | "ok" | "unknown" | null) => ({ sessionId: "s1", tool, result });

  it("zählt je Tool: Fehler nur gegen belegte Ergebnisse, Unbelegtes getrennt", () => {
    const result = aggregateToolStatistics([
      fact("Bash", "failed"), fact("Bash", "ok"), fact("Bash", "ok"),
      fact("Bash", "unknown"), fact("Bash", null),
      fact(null, "ok"),
    ]);
    expect(result).toEqual([
      { tool: "Bash", calls: 5, results: 4, failed: 1, ok: 2, errorStatusUnknown: 1, unanswered: 1, failureRate: 1 / 3 },
      { tool: null, calls: 1, results: 1, failed: 0, ok: 1, errorStatusUnknown: 0, unanswered: 0, failureRate: 0 },
    ]);
    expect(result.map(g => ToolStatistics.parse(g))).toHaveLength(2);
  });

  it("lässt die Fehlerquote ohne belegte Ergebnisse null, nicht null Prozent", () => {
    expect(aggregateToolStatistics([fact("Read", null), fact("Read", "unknown")])[0]).toMatchObject({
      failureRate: null, results: 1, unanswered: 1, errorStatusUnknown: 1,
    });
    expect(() => ToolStatistics.parse({
      ...aggregateToolStatistics([fact("Read", "failed")])[0], failureRate: 0.5,
    })).toThrow();
  });
});
