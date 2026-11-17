import { describe, expect, it } from "vitest";
import { NormalizedEvent, Team } from "@ancientvoid/contracts";
import { HubDatabase } from "../../../src/platform/db.ts";
import {
  StatisticsRollup,
  aggregateSessionStatistics,
  deriveSessionFacts,
  type RollupSource,
} from "../../../src/modules/statistics/index.ts";

const T0 = Date.parse("2026-11-17T10:00:00.000Z");
const event = (seq: number, ms: number, patch: Record<string, unknown> = {}) => NormalizedEvent.parse({
  seq, ts: new Date(T0 + ms).toISOString(),
  sessionId: "s1", type: "system", summary: "fixture", payload: {}, ...patch,
});

/** Journal einer Session mit Zug, Gate, Tool, Interrupt und Recovery. */
const journal = (sessionId: string): NormalizedEvent[] => [
  event(1, 0, { sessionId, type: "user" }),
  event(2, 100, { sessionId, type: "tool_use", payload: { id: "t1", name: "Bash" } }),
  event(3, 200, { sessionId, type: "tool_result", payload: { toolUseId: "t1", isError: true } }),
  event(4, 300, { sessionId, type: "gate", payload: { kind: "tool.permission_requested", approvalId: "a1", toolName: "Bash" } }),
  event(5, 1300, { sessionId, type: "gate", payload: { kind: "tool.permission_answered", approvalId: "a1", behavior: "allow", status: "answered" } }),
  event(6, 1400, { sessionId, payload: { kind: "session.turn_end", code: 0 } }),
  event(7, 1500, { sessionId, payload: { kind: "session.interrupted", reason: "hub_restart" } }),
  event(8, 1600, { sessionId, payload: { kind: "session.turn_end", code: null, reason: "interrupted" } }),
  event(9, 2000, { sessionId, type: "user" }),
  event(10, 3000, { sessionId, payload: { kind: "session.turn_end", code: 0 } }),
];

const team = (id: string, updatedAt: string, status: Team["status"] = "done"): Team => Team.parse({
  id, title: "T", goal: "G", project: "p",
  frame: { adapters: ["dummy"], coordinatorAdapter: null },
  planSource: "given", status,
  tasks: [{ id: "T1", title: "t", prompt: "p", adapter: "dummy", model: null, dependsOn: [], status: "done", dispatches: [{ id: "d1", generation: 1, sessionId: "s1", adapter: "dummy", model: null, startedAt: updatedAt, endedAt: null, status: "done", note: null }], result: null }],
  gates: [], deliveries: [], createdAt: updatedAt, updatedAt,
});

describe("P56 T56.2 Statistik-Rollup", () => {
  it("schreibt Fakten in den Cache und liefert dieselben Aggregate wie die direkte Ableitung (AC-P56-2)", async () => {
    const db = new HubDatabase(":memory:");
    const events = journal("s1");
    const rollup = new StatisticsRollup(db, {
      records: () => [{ id: "s1", adapter: "codex", model: "m1", lastSeq: events.length }],
      events: async () => events,
      teams: () => [team("team1", "2026-11-17T10:00:00.000Z")],
    });
    const result = await rollup.run();
    expect(result).toEqual({ sessionsUpdated: 1, sessionsRemoved: 0, teamsUpdated: 1 });

    const direct = aggregateSessionStatistics([deriveSessionFacts(events, { sessionId: "s1", adapter: "codex", model: "m1" })!]);
    expect(rollup.sessionStatistics()).toEqual(direct);
    expect(rollup.gateWaitStatistics()).toMatchObject({ gates: 1, answered: 1, waitMs: { n: 1, p50: 1000 } });
    expect(rollup.toolStatistics()).toEqual([
      { tool: "Bash", calls: 1, results: 1, failed: 1, ok: 0, errorStatusUnknown: 0, unanswered: 0, failureRate: 1 },
    ]);
    expect(rollup.recoveryDistribution()).toMatchObject({ n: 1, missing: 0, p50: 1500 });
    expect(rollup.teamTaskStatistics()).toMatchObject({ teams: 1, tasks: 1, done: 1, workerEndRate: 1 });
    db.close();
  });

  it("führt nur veränderte Quellen nach und räumt weggefallene Sessions ab", async () => {
    const db = new HubDatabase(":memory:");
    let s1 = journal("s1");
    const s2 = journal("s2");
    const source: RollupSource = {
      records: () => [
        { id: "s1", adapter: "codex", model: null, lastSeq: s1.length },
        { id: "s2", adapter: "codex", model: null, lastSeq: s2.length },
      ],
      events: async id => (id === "s1" ? s1 : s2),
      teams: () => [],
    };
    const rollup = new StatisticsRollup(db, source);
    expect(await rollup.run()).toMatchObject({ sessionsUpdated: 2 });

    // Nichts verändert: kein Update.
    expect(await rollup.run()).toEqual({ sessionsUpdated: 0, sessionsRemoved: 0, teamsUpdated: 0 });

    // Journal wächst (lastSeq steigt): genau diese Session wird neu abgeleitet.
    s1 = [...s1, event(11, 4000, { sessionId: "s1", type: "user" }), event(12, 4500, { sessionId: "s1", payload: { kind: "session.turn_end", code: 0 } })];
    const changed = source.records().map(r => r.id === "s1" ? { ...r, lastSeq: s1.length } : r);
    (source as { records: () => typeof changed }).records = () => changed;
    expect(await rollup.run()).toEqual({ sessionsUpdated: 1, sessionsRemoved: 0, teamsUpdated: 0 });
    expect(rollup.sessionStatistics()[0]).toMatchObject({ sessions: 2, turnsPerSession: { p50: 3.5 } });

    // Quelle verschwindet: Cache-Zeilen werden entfernt, nicht erfunden.
    const only2 = changed.filter(r => r.id === "s2");
    (source as { records: () => typeof only2 }).records = () => only2;
    expect(await rollup.run()).toEqual({ sessionsUpdated: 0, sessionsRemoved: 1, teamsUpdated: 0 });
    expect(rollup.sessionStatistics()[0]).toMatchObject({ sessions: 1 });
    db.close();
  });

  it("ist deterministisch: rebuild liefert dieselben Zahlen wie der inkrementelle Lauf", async () => {
    const db = new HubDatabase(":memory:");
    const events = journal("s1");
    const rollup = new StatisticsRollup(db, {
      records: () => [{ id: "s1", adapter: "codex", model: null, lastSeq: events.length }],
      events: async () => events,
      teams: () => [team("team1", "2026-11-17T10:00:00.000Z")],
    });
    await rollup.run();
    const before = [rollup.sessionStatistics(), rollup.toolStatistics(), rollup.recoveryDistribution(), rollup.teamTaskStatistics()];
    await rollup.rebuild();
    expect([rollup.sessionStatistics(), rollup.toolStatistics(), rollup.recoveryDistribution(), rollup.teamTaskStatistics()]).toEqual(before);
    expect(rollup.gateWaitStatistics()).not.toBeNull();
    db.close();
  });

  it("bleibt ehrlich ohne jede Quelle: leere Leseseite statt erfundener Zahlen", async () => {
    const db = new HubDatabase(":memory:");
    const rollup = new StatisticsRollup(db, { records: () => [], events: async () => [], teams: () => [] });
    expect(await rollup.run()).toEqual({ sessionsUpdated: 0, sessionsRemoved: 0, teamsUpdated: 0 });
    expect(rollup.sessionStatistics()).toEqual([]);
    expect(rollup.gateWaitStatistics()).toBeNull();
    expect(rollup.toolStatistics()).toEqual([]);
    expect(rollup.recoveryDistribution()).toMatchObject({ n: 0, missing: 0, p50: null });
    expect(rollup.teamTaskStatistics()).toBeNull();
    db.close();
  });
});
