import { describe, it, expect } from "vitest";
import { normalizeClaudeClipLine } from "../src/normalize.ts";

// Fixture content here is deliberately SYNTHETIC, not exported from a real
// transcript (that transcript is private conversation data). Field names,
// the `type`/`message.content` envelope, and the bookkeeping line shapes
// are all real, verified against real ~/.claude/projects/<cwd>/*.jsonl
// files on this machine (CLI 2.1.263, 2026-09-19/20) — see normalize.ts's
// own doc comment.

describe("normalizeClaudeClipLine — real transcript schema, synthetic content", () => {
  it("maps a user line with plain-string content (the literal typed prompt) to a user event", () => {
    const events = normalizeClaudeClipLine({
      type: "user",
      message: { role: "user", content: "Fix the off-by-one in the pagination helper" },
    });
    expect(events).toEqual([{ type: "user", summary: "Fix the off-by-one in the pagination helper", payload: { text: "Fix the off-by-one in the pagination helper" } }]);
  });

  it("maps an assistant line with a text content block to an assistant event", () => {
    const events = normalizeClaudeClipLine({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "Found it — index started at 1 instead of 0." }] },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "assistant", summary: "Found it — index started at 1 instead of 0." });
  });

  it("maps thinking, tool_use, tool_result blocks each to their own event, in order", () => {
    const events = normalizeClaudeClipLine({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Let me check the helper first." },
          { type: "tool_use", id: "call-1", name: "read_file", input: { path: "helper.ts" } },
        ],
      },
    });
    expect(events.map((e) => e.type)).toEqual(["thinking", "tool_use"]);
  });

  it("maps a user line whose content is a tool_result block array (a follow-up turn), not a plain string", () => {
    const events = normalizeClaudeClipLine({
      type: "user",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "call-1", content: "export function helper() {}" }] },
    });
    expect(events).toEqual([
      { type: "tool_result", summary: "export function helper() {}", payload: { toolUseId: "call-1", isError: false, content: "export function helper() {}" } },
    ]);
  });

  it("maps attachment/queue-operation to quiet system events, not fail-loud noise", () => {
    expect(normalizeClaudeClipLine({ type: "attachment", attachment: { type: "environment" } })).toEqual([
      { type: "system", summary: "claude-clip: attachment (environment)", payload: { kind: "claude-clip.attachment", attachmentType: "environment" } },
    ]);
    expect(normalizeClaudeClipLine({ type: "queue-operation", operation: "enqueue", content: "Say ok" })[0]).toMatchObject({
      type: "system",
      payload: { kind: "claude-clip.queue-operation", operation: "enqueue" },
    });
  });

  it("silently skips pure internal bookkeeping lines (agent-setting, atis-latch, last-prompt)", () => {
    expect(normalizeClaudeClipLine({ type: "agent-setting", agentSetting: {} })).toEqual([]);
    expect(normalizeClaudeClipLine({ type: "atis-latch", atis: "abc123" })).toEqual([]);
    expect(normalizeClaudeClipLine({ type: "last-prompt", lastPrompt: "Say ok" })).toEqual([]);
  });

  it("fails loud on a genuinely unrecognized line type", () => {
    const events = normalizeClaudeClipLine({ type: "some-future-type", x: 1 });
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("system");
    expect(events[0]!.summary).toContain("unhandled transcript line type");
  });

  it("an empty content-block array becomes a visible system event, not a silent drop", () => {
    const events = normalizeClaudeClipLine({ type: "assistant", message: { role: "assistant", content: [] } });
    expect(events).toEqual([{ type: "system", summary: "claude-clip: assistant message without content blocks", payload: { role: "assistant" } }]);
  });

  it("an empty string user prompt (queued-but-not-yet-sent placeholder) is dropped, not emitted as a blank event", () => {
    expect(normalizeClaudeClipLine({ type: "user", message: { role: "user", content: "" } })).toEqual([]);
  });
});

describe("BUG-0046: leerer Denk-Block im Transcript", () => {
  it("sagt, dass der Text nicht geliefert wird", () => {
    const events = normalizeClaudeClipLine({ type: "assistant", message: { content: [{ type: "thinking", thinking: "", signature: "sig" }] } });
    expect(events[0]).toMatchObject({ type: "thinking", summary: "Claude hat nachgedacht — der Anbieter liefert den Text nicht", payload: { text: "", redacted: true } });
  });
});
