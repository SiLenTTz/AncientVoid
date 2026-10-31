import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { checkFixture } from "@ancientvoid/adapter-testkit";
import { normalizeCopilotLine, extractResultSessionId } from "../src/normalize.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => join(here, "fixtures", name);

describe("normalizeCopilotLine — real captured `copilot --output-format json` (v1.0.86)", () => {
  it("maps a trivial no-tool-use turn to a single assistant event plus housekeeping, real events only", () => {
    const events = checkFixture(fixture("trivial-say-ok.jsonl"), normalizeCopilotLine);

    // The prompt echo stays out of the chat; the hub records the prompt.
    expect(events.filter((e) => e.type === "user")).toHaveLength(0);
    const echo = events.filter((e) => (e.payload as { kind?: string }).kind === "copilot.user_echo");
    expect(echo).toHaveLength(1);
    expect((echo[0]!.payload as { text?: string }).text).toBe("say ok");

    const assistant = events.filter((e) => e.type === "assistant");
    expect(assistant).toHaveLength(1);
    expect(assistant[0]!.summary).toBe("ok");

    // No tool_use/tool_result in this fixture — nothing invented.
    expect(events.some((e) => e.type === "tool_use")).toBe(false);
    expect(events.some((e) => e.type === "tool_result")).toBe(false);

    // Ephemeral streaming frames (message_start/delta, model.call_start,
    // mcp status chatter, assistant.idle) are real but folded away — none
    // leak through as their own events.
    expect(events.some((e) => (e.payload as { kind?: string }).kind === "copilot.model_call_start")).toBe(false);

    const result = events.find((e) => (e.payload as { kind?: string }).kind === "copilot.result");
    expect(result).toBeDefined();
    expect(result!.payload).toMatchObject({ exitCode: 0, premiumRequests: 1 });
  });

  it("maps a real tool_use + tool_result pair from a successful `view` call", () => {
    const events = checkFixture(fixture("tool-use-read-file.jsonl"), normalizeCopilotLine);

    const toolUse = events.filter((e) => e.type === "tool_use");
    expect(toolUse).toHaveLength(1);
    expect(toolUse[0]!.payload).toMatchObject({ tool: "view" });
    expect((toolUse[0]!.payload as { input?: { path?: string } }).input?.path).toContain("a.txt");

    const toolResult = events.filter((e) => e.type === "tool_result");
    expect(toolResult).toHaveLength(1);
    expect(toolResult[0]!.payload).toMatchObject({ toolUseId: toolUse[0]!.payload.id, isError: false });
    expect((toolResult[0]!.payload as { output?: string }).output).toContain("hello world");

    const finalAssistant = events.filter((e) => e.type === "assistant");
    expect(finalAssistant.some((e) => e.summary.includes("hello world"))).toBe(true);
  });

  it("maps a real tool execution failure to tool_result with isError:true, error message and code preserved", () => {
    const events = checkFixture(fixture("tool-error-read-file.jsonl"), normalizeCopilotLine);
    const toolResult = events.find((e) => e.type === "tool_result");
    expect(toolResult).toBeDefined();
    expect(toolResult!.payload).toMatchObject({ isError: true, errorCode: "failure" });
    expect((toolResult!.payload as { error?: string }).error).toContain("Path does not exist");
  });

  it("extractResultSessionId pulls the real session id only from the terminal result line", () => {
    const lines = fixtureLines(fixture("trivial-say-ok.jsonl"));
    const ids = lines.map(extractResultSessionId).filter((id) => id !== undefined);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("fails loud on an unrecognized event type instead of dropping it", () => {
    const events = normalizeCopilotLine({ type: "some_future_event", data: {} });
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("system");
    expect(events[0]!.summary).toContain("unhandled event type");
  });

  it("fails loud on a non-object line instead of throwing", () => {
    const events = normalizeCopilotLine("not an object");
    expect(events[0]!.summary).toContain("non-object");
  });

  it("a line marked ephemeral:true is folded away regardless of its type", () => {
    const events = normalizeCopilotLine({ type: "assistant.message_delta", ephemeral: true, data: { deltaContent: "x" } });
    expect(events).toHaveLength(0);
  });
});

function fixtureLines(path: string): unknown[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}
