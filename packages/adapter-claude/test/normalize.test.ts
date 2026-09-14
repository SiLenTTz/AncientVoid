import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { EmittedEvent } from "@uacc/contracts";
import { normalizeClaudeLine } from "../src/normalize.ts";

const here = dirname(fileURLToPath(import.meta.url));

function loadFixtureLines(name: string): unknown[] {
  return readFileSync(join(here, "fixtures", name), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

describe("normalizeClaudeLine — real captured stream-json (claude 2.1.263)", () => {
  it("maps every line of the trivial-text fixture to schema-valid events", () => {
    const lines = loadFixtureLines("trivial-text.jsonl");
    const events = lines.flatMap(normalizeClaudeLine);
    for (const ev of events) {
      const parsed = EmittedEvent.safeParse(ev);
      expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error?.issues)).toBe(true);
      expect(ev.summary.length).toBeLessThanOrEqual(200);
    }
    // hook_started, hook_response, init -> 3 system events
    expect(events.filter((e) => e.type === "system" && e.summary.startsWith("claude: system/")).length).toBe(3);
    // the assistant text block "ok"
    const assistantEvents = events.filter((e) => e.type === "assistant");
    expect(assistantEvents).toHaveLength(1);
    expect(assistantEvents[0]!.summary).toBe("ok");
    // the result line, with real cost extracted
    const resultEvents = events.filter(
      (e) => e.type === "system" && (e.payload as { kind?: string }).kind === "claude.result",
    );
    expect(resultEvents).toHaveLength(1);
    expect((resultEvents[0]!.payload as { totalCostUsd?: number }).totalCostUsd).toBeCloseTo(0.0454606, 6);
  });

  it("maps the tool-use fixture to tool_use + tool_result + assistant events", () => {
    const lines = loadFixtureLines("tool-use.jsonl");
    const events = lines.flatMap(normalizeClaudeLine);

    const toolUse = events.filter((e) => e.type === "tool_use");
    expect(toolUse).toHaveLength(1);
    expect(toolUse[0]!.payload).toMatchObject({ name: "Bash", input: { command: "echo hello-uacc" } });

    const toolResult = events.filter((e) => e.type === "tool_result");
    expect(toolResult).toHaveLength(1);
    expect(toolResult[0]!.payload).toMatchObject({ isError: false, content: "hello-uacc" });

    const assistantText = events.filter((e) => e.type === "assistant");
    expect(assistantText.map((e) => e.summary)).toContain("done");

    // the fixture also contains a raw "rate_limit_event" line — must map to
    // a valid EventType (system), never pass its own name through.
    const validTypes = new Set(["user", "assistant", "thinking", "tool_use", "tool_result", "gate", "error", "system"]);
    for (const ev of events) expect(validTypes.has(ev.type)).toBe(true);
  });

  it("never drops an unrecognized top-level type silently (fail loud)", () => {
    const events = normalizeClaudeLine({ type: "some_future_event_type", weird: true });
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("system");
    expect(events[0]!.summary).toContain("unhandled stream-json type");
  });

  it("never drops an unrecognized content block silently (fail loud)", () => {
    const events = normalizeClaudeLine({
      type: "assistant",
      message: { content: [{ type: "some_future_block_type" }] },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("system");
    expect(events[0]!.summary).toContain("unhandled assistant content block");
  });

  it("handles a non-object line without throwing", () => {
    expect(() => normalizeClaudeLine("not an object")).not.toThrow();
    expect(normalizeClaudeLine(null)[0]!.type).toBe("system");
  });
});
