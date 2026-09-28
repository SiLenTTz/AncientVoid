import { describe, expect, it } from "vitest";
import { normalizeCursorLine } from "../src/normalize.ts";

const line = (o: object) => normalizeCursorLine(o as Parameters<typeof normalizeCursorLine>[0]);

describe("normalizeCursorLine — claude-kompatibler stream-json", () => {
  it("init kündigt die native Session an", () => {
    const [e] = line({ type: "system", subtype: "init", session_id: "chat_123456789", cwd: "/p", tools: ["Bash", "Edit"] });
    expect(e?.payload).toMatchObject({ kind: "cursor.native_session", nativeSessionId: "chat_123456789", toolCount: 2 });
  });

  it("assistant text/thinking/tool_use und user tool_result", () => {
    expect(line({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Alles klar" }] } })[0]).toMatchObject({ type: "assistant" });
    expect(line({ type: "assistant", message: { role: "assistant", content: [{ type: "thinking", thinking: "Ich überlege" }] } })[0]).toMatchObject({ type: "thinking" });
    const [use] = line({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] } });
    expect(use).toMatchObject({ type: "tool_use" });
    expect(use?.payload).toMatchObject({ id: "t1", name: "Bash" });
    const [res] = line({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "datei.txt", is_error: false }] } });
    expect(res).toMatchObject({ type: "tool_result" });
    expect(res?.payload).toMatchObject({ toolUseId: "t1", isError: false, content: "datei.txt" });
  });

  it("result trägt Kosten, Token-Aufteilung als usage und native Fortsetzungs-Grundlage", () => {
    const [e] = line({ type: "result", subtype: "success", total_cost_usd: 0.0123, usage: { input_tokens: 2000, output_tokens: 300 }, result: "fertig" });
    expect(e?.costUsd).toBeCloseTo(0.0123, 6);
    expect(e?.tokensEst).toBe(2300);
    expect(e?.payload).toMatchObject({ kind: "cursor.result", usage: { input: 2000, output: 300 } });
  });

  it("unbekannte Typen bleiben sichtbar, nie gedroppt", () => {
    expect(line({ type: "hologram" })[0]?.payload).toMatchObject({ kind: "cursor.unhandled", type: "hologram" });
    expect(line({})).toEqual([]);
  });
});
