import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  opencodeEnhanceArgs,
  parseClaudeEnhanceOutput,
  parseCodexEnhanceOutput,
  parseOpencodeEnhanceOutput,
} from "../src/enhance.ts";

describe("parseClaudeEnhanceOutput (T1.5-8)", () => {
  it("extracts the rewritten prompt and real cost from claude's --output-format json blob", () => {
    // Real captured output (2026-09-16, this session): claude -p
    // "...rewrite instruction...\n\n---\nmach das mit dem login besser"
    // --output-format json --tools "" --dangerously-skip-permissions
    const real = JSON.stringify({
      duration_api_ms: 6576,
      stop_reason: "end_turn",
      session_id: "63b9520a-860f-4ace-a0c4-f1b6dda4a3f3",
      total_cost_usd: 0.065402,
      is_error: false,
      result:
        "Ziel: Die bestehende Login-Funktionalität verbessern.\n\nScope: Login-bezogene Dateien identifizieren.\n\nConstraints: Bestehende Funktionalität darf nicht brechen.\n\nErfolgskriterium: Login funktioniert weiterhin fehlerfrei.",
    });
    const parsed = parseClaudeEnhanceOutput(real);
    expect(parsed.enhanced).toContain("Ziel:");
    expect(parsed.enhanced).toContain("Erfolgskriterium:");
    expect(parsed.costUsd).toBeCloseTo(0.065402, 6);
  });

  it("returns no costUsd when the field is absent, never a guessed number", () => {
    const parsed = parseClaudeEnhanceOutput(JSON.stringify({ result: "Ziel: x" }));
    expect(parsed.costUsd).toBeUndefined();
  });

  it("returns an empty string, not a throw, when result is missing", () => {
    const parsed = parseClaudeEnhanceOutput(JSON.stringify({ total_cost_usd: 0.01 }));
    expect(parsed.enhanced).toBe("");
  });
});

describe("parseCodexEnhanceOutput (T1.5-8)", () => {
  it("extracts the agent_message text from a real-shaped codex --json stream", () => {
    // Same JSONL shape as the real adapter-codex fixtures (T1.3): flat
    // top-level type, item.completed carrying an agent_message.
    const lines = [
      JSON.stringify({ type: "thread.started", thread_id: "x" }),
      JSON.stringify({ type: "turn.started" }),
      JSON.stringify({
        type: "item.completed",
        item: { id: "item_0", type: "agent_message", text: "Ziel: y\n\nScope: z" },
      }),
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5 } }),
    ].join("\n");
    const parsed = parseCodexEnhanceOutput(lines);
    expect(parsed.enhanced).toBe("Ziel: y\n\nScope: z");
  });

  it("never sets costUsd — codex has no native cost figure (T1.11/R9.7)", () => {
    const parsed = parseCodexEnhanceOutput(
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "x" } }),
    );
    expect(parsed.costUsd).toBeUndefined();
  });

  it("ignores non-JSON lines instead of throwing (fail loud elsewhere, not crash here)", () => {
    const lines = ["not json at all", JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "ok" } })].join(
      "\n",
    );
    expect(() => parseCodexEnhanceOutput(lines)).not.toThrow();
    expect(parseCodexEnhanceOutput(lines).enhanced).toBe("ok");
  });

  it("returns an empty string when no agent_message item ever appears", () => {
    const parsed = parseCodexEnhanceOutput(JSON.stringify({ type: "turn.completed", usage: {} }));
    expect(parsed.enhanced).toBe("");
  });
});

describe("opencodeEnhanceArgs", () => {
  it("puts the flags before the multiline prompt so the CLI cannot swallow them", () => {
    const args = opencodeEnhanceArgs("mach das spiel neon");
    const sep = args.indexOf("--");
    expect(args.slice(0, sep)).toEqual(["run", "--format", "json", "--auto", "--agent", "plan"]);
    expect(args[sep + 1]).toContain("\n");
    expect(args[sep + 1]?.endsWith("mach das spiel neon")).toBe(true);
    expect(args.slice(sep + 2)).toEqual([]);
  });
});

describe("parseOpencodeEnhanceOutput", () => {
  it("extracts the text part and sums real step costs from a captured opencode stream", () => {
    const fixture = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../adapter-opencode/test/fixtures/trivial-read.jsonl"),
      "utf8",
    );
    const parsed = parseOpencodeEnhanceOutput(fixture);
    expect(parsed.enhanced).toContain("hello");
    expect(parsed.costUsd).toBe(0);
  });

  it("ignores non-JSON lines and omits cost when no step_finish reports one", () => {
    const parsed = parseOpencodeEnhanceOutput(
      ["noise", JSON.stringify({ type: "text", part: { text: "Ziel: x" } })].join("\n"),
    );
    expect(parsed.enhanced).toBe("Ziel: x");
    expect(parsed.costUsd).toBeUndefined();
  });
});
