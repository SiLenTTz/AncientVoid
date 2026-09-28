import { describe, expect, it } from "vitest";
import { normalizeCursorLine } from "../src/normalize.ts";

const line = (o: object, state = { thinking: "" }) => normalizeCursorLine(o as Parameters<typeof normalizeCursorLine>[0], state);

describe("normalizeCursorLine — echte cursor-agent-Formen (live 2026-09-29)", () => {
  it("init kündigt die native Session an", () => {
    const [e] = line({ type: "system", subtype: "init", session_id: "chat_123456789", cwd: "/p", tools: ["Bash", "Edit"] });
    expect(e?.payload).toMatchObject({ kind: "cursor.native_session", nativeSessionId: "chat_123456789", toolCount: 2 });
  });

  it("thinking kommt als Top-Level-Deltas und wird erst bei completed ein Event", () => {
    const state = { thinking: "" };
    expect(line({ type: "thinking", subtype: "delta", text: "Die Antwort " }, state)).toEqual([]);
    expect(line({ type: "thinking", subtype: "delta", text: "ist kurz." }, state)).toEqual([]);
    const [e] = line({ type: "thinking", subtype: "completed" }, state);
    expect(e).toMatchObject({ type: "thinking" });
    expect(e?.payload).toMatchObject({ text: "Die Antwort ist kurz." });
  });

  it("assistant text/tool_use und user tool_result; der Prompt-Echo bleibt draußen", () => {
    expect(line({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Alles klar" }] } })[0]).toMatchObject({ type: "assistant" });
    const [use] = line({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] } });
    expect(use?.payload).toMatchObject({ id: "t1", name: "Bash" });
    const [res] = line({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "datei.txt", is_error: false }] } });
    expect(res?.payload).toMatchObject({ toolUseId: "t1", isError: false, content: "datei.txt" });
    expect(line({ type: "user", message: { role: "user", content: [{ type: "text", text: "eigener Prompt" }] } })).toEqual([]);
  });

  it("result nutzt camelCase-Usage (inputTokens/outputTokens); Kosten optional", () => {
    const [e] = line({ type: "result", subtype: "success", usage: { inputTokens: 15694, outputTokens: 28, cacheReadTokens: 2688 }, result: "cursor ok" });
    expect(e?.tokensEst).toBe(15722);
    expect(e?.costUsd).toBeUndefined();
    expect(e?.payload).toMatchObject({ usage: { input: 15694, output: 28 } });
    const [withCost] = line({ type: "result", subtype: "success", total_cost_usd: 0.01, usage: { input_tokens: 10, output_tokens: 5 } });
    expect(withCost?.costUsd).toBeCloseTo(0.01, 5);
    expect(withCost?.tokensEst).toBe(15);
  });

  it("unbekannte Typen bleiben sichtbar, nie gedroppt", () => {
    expect(line({ type: "hologram" })[0]?.payload).toMatchObject({ kind: "cursor.unhandled", type: "hologram" });
    expect(line({})).toEqual([]);
  });
});
