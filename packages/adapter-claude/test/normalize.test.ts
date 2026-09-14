import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { checkFixture } from "@uacc/adapter-testkit";
import { normalizeClaudeLine } from "../src/normalize.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => join(here, "fixtures", name);

describe("normalizeClaudeLine — real captured stream-json (claude 2.1.263)", () => {
  it("maps every line of the trivial-text fixture to schema-valid events", () => {
    // checkFixture (T1.4, @uacc/adapter-testkit) loads the fixture, runs
    // every line through the normalizer, and asserts schema-validity —
    // the generic half of this check; provider-specific assertions follow.
    const events = checkFixture(fixture("trivial-text.jsonl"), normalizeClaudeLine);
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
    const events = checkFixture(fixture("tool-use.jsonl"), normalizeClaudeLine);

    const toolUse = events.filter((e) => e.type === "tool_use");
    expect(toolUse).toHaveLength(1);
    expect(toolUse[0]!.payload).toMatchObject({ name: "Bash", input: { command: "echo hello-uacc" } });

    const toolResult = events.filter((e) => e.type === "tool_result");
    expect(toolResult).toHaveLength(1);
    expect(toolResult[0]!.payload).toMatchObject({ isError: false, content: "hello-uacc" });

    const assistantText = events.filter((e) => e.type === "assistant");
    expect(assistantText.map((e) => e.summary)).toContain("done");
    // The fixture also contains a raw "rate_limit_event" line — checkFixture
    // already asserted every event's `type` is a valid EventType (via the
    // NormalizedEvent schema), so it can't have passed that name through.
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
