import { describe, expect, it } from "vitest";
import { quotaSummary, runProgress } from "../../../src/features/session/run-progress.ts";
import type { NormalizedEvent } from "../../../src/shared/ws.ts";

const at = (s: number) => new Date(Date.UTC(2026, 8, 23, 12, 0, s)).toISOString();
const ev = (seq: number, sec: number, type: string, payload: Record<string, unknown>, summary = ""): NormalizedEvent => ({
  seq, ts: at(sec), sessionId: "s", type, summary, payload, blobRef: null,
});
const todos = (statuses: string[], tool = "todowrite") =>
  ({ id: "t", tool, input: { todos: statuses.map((status, i) => ({ content: `Aufgabe ${i}`, status })) } });

describe("runProgress", () => {
  it("counts the agent's own plan and extrapolates the rest", () => {
    const events = [
      ev(1, 0, "user", { kind: "session.prompt", text: "los" }),
      ev(2, 10, "tool_use", todos(["pending", "pending", "pending", "pending"])),
      ev(3, 60, "tool_use", todos(["completed", "in_progress", "pending", "pending"])),
    ];
    const p = runProgress(events, "working", Date.parse(at(60)))!;
    expect(p).toMatchObject({ done: 1, total: 4, percent: 25, source: "todos", elapsedMs: 60_000 });
    expect(p.etaMs).toBe(180_000);
  });

  it("reads Claude's TodoWrite and leaves cancelled items out", () => {
    const events = [ev(1, 0, "user", { kind: "session.prompt", text: "x" }), ev(2, 30, "tool_use", { id: "c", name: "TodoWrite", input: { todos: [{ status: "completed" }, { status: "cancelled" }, { status: "pending" }] } })];
    expect(runProgress(events, "working", Date.parse(at(30)))).toMatchObject({ done: 1, total: 2, percent: 50 });
  });

  it("has no percent without a plan, and nothing when not working", () => {
    const events = [ev(1, 0, "user", { kind: "session.prompt", text: "x" }), ev(2, 5, "assistant", { text: "hi" })];
    expect(runProgress(events, "working", Date.parse(at(90)))).toMatchObject({ source: "none", percent: null, etaMs: null, elapsedMs: 90_000 });
    expect(runProgress(events, "idle", Date.parse(at(90)))).toBeNull();
  });

  it("only counts the plan of the current turn", () => {
    const events = [
      ev(1, 0, "user", { kind: "session.prompt", text: "a" }),
      ev(2, 5, "tool_use", todos(["completed", "completed"])),
      ev(3, 20, "user", { kind: "session.prompt", text: "b" }),
    ];
    expect(runProgress(events, "working", Date.parse(at(30)))).toMatchObject({ source: "none", elapsedMs: 10_000 });
  });
});

describe("quotaSummary", () => {
  it("names what is left per window, tightest first", () => {
    const usage = {
      supported: true,
      quota: { windows: [{ id: "seven_day", utilization: 0.2, resetsAt: "2026-09-28T00:00:00Z" }, { id: "five_hour", utilization: 0.62, resetsAt: "2026-09-23T14:00:00Z" }] },
    };
    const s = quotaSummary(usage, []);
    expect(s.level).toBe("ok");
    expect(s.text).toMatch(/^5h: 38 % frei · reset \d\d:\d\d · 7d: 80 % frei/);
  });

  it("warns when a window is nearly used up", () => {
    const usage = { supported: true, quota: { windows: [{ id: "five_hour", utilization: 0.93, resetsAt: "2026-09-23T14:00:00Z" }] } };
    expect(quotaSummary(usage, []).level).toBe("warn");
  });

  it("falls back to the provider's own limit error", () => {
    const events = [ev(1, 0, "system", { kind: "provider.error", category: "quota", window: "5 h", resetAt: "2026-09-23 15:00:00" })];
    expect(quotaSummary({ supported: false, quota: null }, events)).toEqual({ text: "5 h: erschöpft · frei ab 2026-09-23 15:00:00", level: "err" });
  });

  it("says so when nothing is known", () => {
    expect(quotaSummary(null, [])).toEqual({ text: "Kontingent: Provider meldet nichts", level: "none" });
  });
});
