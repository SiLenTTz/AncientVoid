import { describe, expect, it } from "vitest";
import { claudeStreamDelta, normalizeClaudeLine } from "../src/normalize.ts";

/**
 * ADR-0083 / BUG-0178: claude carries its real deltas inside `stream_event`
 * envelopes. Recognising them is what turns claude's output into live frames —
 * and every shape we do NOT recognise must still surface as the old envelope
 * event (fail loud, never a silent drop).
 */
const env = (event: Record<string, unknown>) => ({ type: "stream_event", event, session_id: "s1" });

describe("claude stream_event — Deltas erkennen", () => {
  it("Text-Delta wird als assistant-Teil erkannt", () => {
    expect(claudeStreamDelta(env({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Zwitschern" } })))
      .toEqual({ inner: "delta", index: 0, stream: "assistant", text: "Zwitschern" });
  });

  it("Thinking-Delta wird als thinking-Teil erkannt", () => {
    expect(claudeStreamDelta(env({ type: "content_block_delta", index: 1, delta: { type: "thinking_delta", thinking: "Erwägen" } })))
      .toEqual({ inner: "delta", index: 1, stream: "thinking", text: "Erwägen" });
  });

  it("Block-Anfang merkt sich, welcher Strom gemeint ist", () => {
    expect(claudeStreamDelta(env({ type: "content_block_start", index: 2, content_block: { type: "thinking" } })))
      .toEqual({ inner: "start", index: 2, stream: "thinking", text: "" });
    expect(claudeStreamDelta(env({ type: "content_block_stop", index: 2 })))
      .toEqual({ inner: "stop", index: 2, stream: "assistant", text: "" });
  });

  it("Werkzeug-Argumente und Usage-Hüllen bleiben unberührt", () => {
    expect(claudeStreamDelta(env({ type: "content_block_delta", index: 3, delta: { type: "input_json_delta", partial_json: "{" } }))).toBeNull();
    expect(claudeStreamDelta(env({ type: "content_block_start", index: 3, content_block: { type: "tool_use" } }))).toBeNull();
    expect(claudeStreamDelta(env({ type: "message_delta", usage: { output_tokens: 11 } }))).toBeNull();
    expect(claudeStreamDelta({ type: "assistant" })).toBeNull();
  });

  it("erkannte Deltas erzeugen kein Ereignis, unbekannte Hüllen weiterhin eines", () => {
    expect(normalizeClaudeLine(env({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " Hallo" } }))).toEqual([]);
    const events = normalizeClaudeLine(env({ type: "content_block_delta", index: 0, delta: { type: "was_auch_immer" } }));
    expect(events).toHaveLength(1);
    expect(events[0]!.summary).toContain("stream envelope");
  });
});
