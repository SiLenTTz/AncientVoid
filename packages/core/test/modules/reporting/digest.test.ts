import { describe, it, expect } from "vitest";
import { SessionRecord, type NormalizedEvent } from "@ancientvoid/contracts";
import { buildSessionSummary, archiveRefFor } from "../../../src/modules/reporting/digest.ts";

function record(overrides?: Partial<SessionRecord>): SessionRecord {
  return SessionRecord.parse({
    id: "s1",
    adapter: "claude",
    project: "/tmp/project",
    worktreeSha: null,
    model: "claude-opus",
    status: "stopped",
    createdAt: "2026-09-18T00:00:00.000Z",
    budgetUsd: null,
    adapterVersion: "0.1.0",
    lastSeq: 0,
    costUsd: 1.5,
    tokensEst: 4200,
    updatedAt: "2026-09-18T00:10:00.000Z",
    parkReason: null,
    ...overrides,
  });
}

function ev(seq: number, overrides: Partial<NormalizedEvent>): NormalizedEvent {
  return {
    seq,
    ts: "2026-09-18T00:00:00.000Z",
    sessionId: "s1",
    type: "system",
    summary: "system.event",
    payload: {},
    blobRef: null,
    ...overrides,
  };
}

describe("archiveRefFor — EventStore's own real path convention", () => {
  it("matches sessions/<id>/events.jsonl", () => {
    expect(archiveRefFor("abc-123")).toBe("sessions/abc-123/events.jsonl");
  });
});

describe("buildSessionSummary — rule-based digest extraction, no LLM", () => {
  it("carries session metadata straight from the record", () => {
    const summary = buildSessionSummary(record(), []);
    expect(summary).toMatchObject({
      sessionId: "s1",
      adapter: "claude",
      project: "/tmp/project",
      model: "claude-opus",
      startedAt: "2026-09-18T00:00:00.000Z",
      endedAt: "2026-09-18T00:10:00.000Z",
      costUsd: 1.5,
      tokensEst: 4200,
      eventCount: 0,
      archiveRef: "sessions/s1/events.jsonl",
    });
  });

  it("extracts a gate event as a decision lesson, quote-grounded by its real seq", () => {
    const events = [ev(3, { type: "gate", summary: "human approved the plan" })];
    const summary = buildSessionSummary(record(), events);
    expect(summary.lessons).toEqual([{ kind: "decision", text: "human approved the plan", eventSeq: [3] }]);
  });

  it("extracts an error event as a failure lesson", () => {
    const events = [ev(7, { type: "error", summary: "adapter crashed mid-turn" })];
    const summary = buildSessionSummary(record(), events);
    expect(summary.lessons).toEqual([{ kind: "failure", text: "adapter crashed mid-turn", eventSeq: [7] }]);
  });

  it("maps real SessionManager system-event kinds to the right lesson kind", () => {
    const events = [
      ev(1, { type: "system", summary: "session.approval_decided", payload: { kind: "session.approval_decided" } }),
      ev(2, { type: "system", summary: "session.budget_exceeded", payload: { kind: "session.budget_exceeded" } }),
      ev(3, { type: "system", summary: "session.worktree_failed", payload: { kind: "session.worktree_failed" } }),
      ev(4, { type: "system", summary: "session.parked", payload: { kind: "session.parked" } }),
    ];
    const summary = buildSessionSummary(record(), events);
    expect(summary.lessons.map((l) => l.kind)).toEqual(["approval", "budget", "failure", "decision"]);
  });

  it("does not digest routine system events (e.g. session.created, session.steer) — not everything is a lesson", () => {
    const events = [
      ev(1, { type: "system", summary: "session.created", payload: { kind: "session.created" } }),
      ev(2, { type: "system", summary: "session.steer", payload: { kind: "session.steer", steerKind: "prompt" } }),
    ];
    const summary = buildSessionSummary(record(), events);
    expect(summary.lessons).toEqual([]);
  });

  it("ignores adapter-emitted system events with no recognized payload.kind", () => {
    const events = [ev(1, { type: "system", summary: "claude: rate-limit status update", payload: { info: {} } })];
    expect(buildSessionSummary(record(), events).lessons).toEqual([]);
  });

  it("never touches user/assistant/tool_use/tool_result/thinking events — no full-text leakage into lessons", () => {
    const events = [
      ev(1, { type: "user", summary: "do the thing" }),
      ev(2, { type: "assistant", summary: "done" }),
      ev(3, { type: "tool_use", summary: "read file.ts" }),
      ev(4, { type: "tool_result", summary: "contents" }),
      ev(5, { type: "thinking", summary: "reasoning about it" }),
    ];
    expect(buildSessionSummary(record(), events).lessons).toEqual([]);
    expect(buildSessionSummary(record(), events).eventCount).toBe(5);
  });
});
