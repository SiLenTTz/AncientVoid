import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { checkFixture } from "@uacc/adapter-testkit";
import { normalizeCodexLine } from "../src/normalize.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => join(here, "fixtures", name);

describe("normalizeCodexLine — real captured stream-json (codex-cli 0.153.4)", () => {
  it("maps every line of the trivial-text fixture to schema-valid events", () => {
    // checkFixture (T1.4, @uacc/adapter-testkit) loads the fixture, runs
    // every line through the normalizer, and asserts schema-validity —
    // the generic half of this check; provider-specific assertions follow.
    const events = checkFixture(fixture("trivial-text.jsonl"), normalizeCodexLine);
    const assistantEvents = events.filter((e) => e.type === "assistant");
    expect(assistantEvents).toHaveLength(1);
    expect(assistantEvents[0]!.summary).toBe("ok");

    const turnComplete = events.find((e) => (e.payload as { kind?: string }).kind === "codex.turn_complete");
    expect(turnComplete).toBeDefined();
    // No model requested (checkFixture never passes one) -> no price-table
    // lookup possible -> costUsd stays unset, never guessed (T1.11, R9.7).
    expect(turnComplete!.costUsd).toBeUndefined();
    expect((turnComplete!.payload as { costEstimated?: boolean }).costEstimated).toBe(false);
  });

  it("T1.11: estimates costUsd from token usage when a priced model was requested", () => {
    const events = checkFixture(fixture("trivial-text.jsonl"), (line) => normalizeCodexLine(line, "gpt-5.3-codex"));
    const turnComplete = events.find((e) => (e.payload as { kind?: string }).kind === "codex.turn_complete");
    expect(turnComplete).toBeDefined();
    // Fixture usage: input_tokens 15500, cached_input_tokens 11136,
    // output_tokens 5. gpt-5.3-codex pricing (pricing.ts, sourced
    // 2026-09-15): $1.75/$0.175/$14.00 per 1M (input/cached/output).
    const expected = ((15500 - 11136) * 1.75 + 11136 * 0.175 + 5 * 14.0) / 1_000_000;
    expect(turnComplete!.costUsd).toBeCloseTo(expected, 10);
    expect((turnComplete!.payload as { costEstimated?: boolean }).costEstimated).toBe(true);
  });

  it("T1.11: an unpriced model still leaves costUsd unset (R9.7 — unbekannt statt geraten)", () => {
    const events = checkFixture(fixture("trivial-text.jsonl"), (line) => normalizeCodexLine(line, "some-future-model"));
    const turnComplete = events.find((e) => (e.payload as { kind?: string }).kind === "codex.turn_complete");
    expect(turnComplete!.costUsd).toBeUndefined();
    expect((turnComplete!.payload as { costEstimated?: boolean }).costEstimated).toBe(false);
  });

  it("maps the tool-use fixture to tool_use + tool_result + assistant events", () => {
    const events = checkFixture(fixture("tool-use.jsonl"), normalizeCodexLine);

    const toolUse = events.filter((e) => e.type === "tool_use");
    expect(toolUse).toHaveLength(1);
    expect(toolUse[0]!.summary).toContain("echo hello-uacc");

    const toolResult = events.filter((e) => e.type === "tool_result");
    expect(toolResult).toHaveLength(1);
    expect(toolResult[0]!.payload).toMatchObject({ isError: false, exitCode: 0, content: "hello-uacc\n" });

    const assistantText = events.filter((e) => e.type === "assistant").map((e) => e.summary);
    expect(assistantText).toContain("done");
  });

  it("captures thread_id from thread.started for resume", () => {
    const events = checkFixture(fixture("resume.jsonl"), normalizeCodexLine);
    const started = events.find((e) => e.summary === "codex: thread started");
    expect((started?.payload as { threadId?: string }).threadId).toBe("01a0a1fe-e6d8-7542-8f87-f62bfdcd2954");
  });

  it("never drops an unrecognized top-level type silently (fail loud)", () => {
    const events = normalizeCodexLine({ type: "some_future_event_type", weird: true });
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("system");
    expect(events[0]!.summary).toContain("unhandled stream-json type");
  });

  it("never drops an unrecognized item type silently (fail loud)", () => {
    const events = normalizeCodexLine({
      type: "item.completed",
      item: { id: "x", type: "some_future_item_type" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("system");
    expect(events[0]!.summary).toContain("unhandled item type");
  });

  it("handles a non-object line without throwing", () => {
    expect(() => normalizeCodexLine("not an object")).not.toThrow();
    expect(normalizeCodexLine(null)[0]!.type).toBe("system");
  });
});

describe("provider errors (ADR-0015)", () => {
  it("names a failed turn instead of an unhandled line", () => {
    const [event] = normalizeCodexLine({ type: "turn.failed", error: { message: "stream error: 429 Too Many Requests" } });
    expect(event?.summary).toBe("codex: Rate-Limit des Providers");
    expect(event?.payload).toMatchObject({ kind: "provider.error", category: "rate_limit" });
  });
});
