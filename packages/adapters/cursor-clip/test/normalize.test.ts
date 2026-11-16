import { describe, it, expect } from "vitest";
import { decodeBubble, decodeComposerData, SUPPORTED_BUBBLE_VERSION } from "../src/normalize.ts";

// Fixture content here is deliberately SYNTHETIC, not exported from a real
// user's Cursor history (that history is private data — see normalize.ts's
// doc comment). Field names, the `_v` marker, the type enum and
// toolFormerData's shape are all real, verified against a live Cursor
// installation's state.vscdb on 2026-09-18.

function userBubble(text: string) {
  return { _v: SUPPORTED_BUBBLE_VERSION, type: 1, bubbleId: "b-user-1", text };
}

describe("decodeBubble — real Cursor bubble schema, synthetic content", () => {
  it("maps a user bubble (type:1) to a user event", () => {
    const events = decodeBubble(userBubble("read note.txt and tell me its contents"));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "user", summary: "read note.txt and tell me its contents" });
  });

  it("maps an assistant bubble (type:2) with thinking + tool call + final text to three events in order", () => {
    const bubble = {
      _v: SUPPORTED_BUBBLE_VERSION,
      type: 2,
      thinking: { text: "I should read the file first." },
      thinkingDurationMs: 1200,
      toolFormerData: {
        toolCallId: "call-1",
        name: "read_file_v2",
        status: "completed",
        params: JSON.stringify({ path: "note.txt" }),
        result: JSON.stringify({ content: "hello world" }),
      },
      text: "The file contains: hello world",
      tokenCount: { inputTokens: 120, outputTokens: 30 },
    };
    const events = decodeBubble(bubble);
    expect(events.map((e) => e.type)).toEqual(["thinking", "tool_use", "tool_result", "assistant"]);
    expect(events[0]!.payload).toMatchObject({ text: "I should read the file first.", durationMs: 1200 });
    expect(events[1]!.payload).toMatchObject({ id: "call-1", tool: "read_file_v2" });
    expect(events[2]!.payload).toMatchObject({ toolUseId: "call-1", isError: false });
    expect((events[2]!.payload as { output?: unknown }).output).toEqual({ content: "hello world" });
    expect(events[3]!.summary).toBe("The file contains: hello world");
    expect(events[3]!.tokensEst).toBe(150);
  });

  it("maps a real tool error shape (JSON-encoded error field) to tool_result isError:true", () => {
    const bubble = {
      _v: SUPPORTED_BUBBLE_VERSION,
      type: 2,
      toolFormerData: {
        toolCallId: "call-2",
        name: "glob_file_search",
        status: "error",
        params: "{}",
        result: "{}",
        error: JSON.stringify({ clientVisibleErrorMessage: "Timed out after 25s", modelVisibleErrorMessage: "Timed out after 25s" }),
      },
    };
    const events = decodeBubble(bubble);
    const toolResult = events.find((e) => e.type === "tool_result");
    expect(toolResult).toBeDefined();
    expect(toolResult!.payload).toMatchObject({ isError: true, error: "Timed out after 25s" });
  });

  it("maps a real cancelled tool call (no error payload at all) to tool_result isError:true with a synthesized label", () => {
    const bubble = {
      _v: SUPPORTED_BUBBLE_VERSION,
      type: 2,
      toolFormerData: { toolCallId: "call-3", name: "run_terminal_command_v2", status: "cancelled", params: "{}" },
    };
    const events = decodeBubble(bubble);
    const toolResult = events.find((e) => e.type === "tool_result");
    expect(toolResult!.payload).toMatchObject({ isError: true, error: "cancelled by user" });
  });

  it("a still-running tool call (status:loading) emits only tool_use, no tool_result yet", () => {
    const bubble = { _v: SUPPORTED_BUBBLE_VERSION, type: 2, toolFormerData: { toolCallId: "call-4", name: "run_terminal_command_v2", status: "loading", params: "{}" } };
    const events = decodeBubble(bubble);
    expect(events.map((e) => e.type)).toEqual(["tool_use"]);
  });

  it("fails loud on an unrecognized _v version instead of guessing field meanings", () => {
    const events = decodeBubble({ _v: 99, type: 2, text: "hello" });
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("system");
    expect(events[0]!.summary).toContain("unsupported bubble format version 99");
  });

  it("fails loud on an unhandled bubble type", () => {
    const events = decodeBubble({ _v: SUPPORTED_BUBBLE_VERSION, type: 7 });
    expect(events[0]!.type).toBe("system");
    expect(events[0]!.summary).toContain("unhandled bubble type");
  });

  it("an empty assistant bubble (no thinking/tool/text) is a visible system event, not a silent drop", () => {
    const events = decodeBubble({ _v: SUPPORTED_BUBBLE_VERSION, type: 2 });
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("system");
    expect(events[0]!.summary).toContain("no thinking, tool call or text");
  });

  it("fails loud on a non-object line", () => {
    expect(decodeBubble("nope")[0]!.summary).toContain("non-object");
  });
});

describe("decodeComposerData — real composerData:<id> shape, synthetic content", () => {
  it("extracts the real ordered header list and status/model fields", () => {
    const raw = {
      fullConversationHeadersOnly: [
        { bubbleId: "b1", type: 1, createdAt: "" },
        { bubbleId: "b2", type: 2, createdAt: "" },
      ],
      status: "completed",
      modelConfig: { modelName: "grok-4.6" },
      contextTokensUsed: 1000,
      contextTokenLimit: 256000,
    };
    const summary = decodeComposerData(raw);
    expect(summary).not.toBeNull();
    expect(summary!.headers).toEqual([
      { bubbleId: "b1", type: 1 },
      { bubbleId: "b2", type: 2 },
    ]);
    expect(summary!.status).toBe("completed");
    expect(summary!.modelName).toBe("grok-4.6");
  });

  it("returns null (real schema break) when fullConversationHeadersOnly is missing", () => {
    expect(decodeComposerData({ status: "completed" })).toBeNull();
  });

  it("returns null on a non-object", () => {
    expect(decodeComposerData("nope")).toBeNull();
  });
});
