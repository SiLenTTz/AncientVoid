import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { EmittedEvent } from "@uacc/contracts";
import { normalizeCodexLine } from "../src/normalize.ts";

const here = dirname(fileURLToPath(import.meta.url));

function loadFixtureLines(name: string): unknown[] {
  return readFileSync(join(here, "fixtures", name), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

describe("normalizeCodexLine — real captured stream-json (codex-cli 0.153.4)", () => {
  it("maps every line of the trivial-text fixture to schema-valid events", () => {
    const lines = loadFixtureLines("trivial-text.jsonl");
    const events = lines.flatMap(normalizeCodexLine);
    for (const ev of events) {
      const parsed = EmittedEvent.safeParse(ev);
      expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error?.issues)).toBe(true);
      expect(ev.summary.length).toBeLessThanOrEqual(200);
    }
    const assistantEvents = events.filter((e) => e.type === "assistant");
    expect(assistantEvents).toHaveLength(1);
    expect(assistantEvents[0]!.summary).toBe("ok");

    const turnComplete = events.find((e) => (e.payload as { kind?: string }).kind === "codex.turn_complete");
    expect(turnComplete).toBeDefined();
    // No cost field anywhere — codex reports tokens only (T1.11).
    expect(JSON.stringify(turnComplete!.payload)).not.toContain("cost");
  });

  it("maps the tool-use fixture to tool_use + tool_result + assistant events", () => {
    const lines = loadFixtureLines("tool-use.jsonl");
    const events = lines.flatMap(normalizeCodexLine);

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
    const lines = loadFixtureLines("resume.jsonl");
    const events = lines.flatMap(normalizeCodexLine);
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
