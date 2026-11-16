import type { EmittedEvent } from "@ancientvoid/contracts";

/**
 * cursor-agent stream-json (one JSON object per line, claude-code shape —
 * the CLI mirrors Claude Code's event model; verified against the
 * stand-in until a logged-in run confirms the last details, anything
 * unknown stays visible as a system event, never dropped).
 */
export interface CursorLine {
  type?: unknown;
  subtype?: unknown;
  session_id?: unknown;
  chatId?: unknown;
  /** Top-level thinking deltas (real cursor-agent, verified live 2026-09-29). */
  text?: unknown;
  message?: { role?: unknown; content?: unknown } | null;
  result?: unknown;
  is_error?: unknown;
  total_cost_usd?: unknown;
  usage?: { input_tokens?: unknown; output_tokens?: unknown; inputTokens?: unknown; outputTokens?: unknown } | null;
  cwd?: unknown;
  tools?: unknown;
}

function summarize(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

interface ContentBlock {
  type?: unknown;
  text?: unknown;
  thinking?: unknown;
  id?: unknown;
  tool_use_id?: unknown;
  name?: unknown;
  input?: unknown;
  content?: unknown;
  is_error?: unknown;
}

/** Maps one parsed stdout line to hub events (empty for progress noise).
 * Stateful: top-level thinking deltas buffer until their "completed". */
export function normalizeCursorLine(line: CursorLine, state: { thinking: string } = { thinking: "" }): EmittedEvent[] {
  const type = asString(line.type);
  const session = asString(line.session_id) ?? asString(line.chatId) ?? null;
  const out: EmittedEvent[] = [];
  if (type === "system") {
    const subtype = asString(line.subtype) ?? "unknown";
    if (subtype === "init" && session) {
      out.push({
        type: "system",
        summary: `cursor · Session ${session.slice(0, 12)}`,
        payload: { kind: "cursor.native_session", nativeSessionId: session, cwd: asString(line.cwd) ?? null, toolCount: Array.isArray(line.tools) ? line.tools.length : null },
      });
    } else {
      out.push({ type: "system", summary: `cursor: system/${subtype}`, payload: { kind: "cursor.system", subtype } });
    }
    return out;
  }
  if (type === "thinking") {
    // real shape (live 2026-09-29): {"type":"thinking","subtype":"delta","text":"…"}
    // deltas stream individually, "completed" closes the thought.
    if (asString(line.subtype) === "delta" && typeof line.text === "string") {
      state.thinking += line.text;
    } else if (asString(line.subtype) === "completed") {
      const text = state.thinking;
      state.thinking = "";
      if (text) out.push({ type: "thinking", summary: summarize(text), payload: { text } });
    }
    return out;
  }
  if (type === "assistant" && line.message && Array.isArray(line.message.content)) {
    for (const block of line.message.content as ContentBlock[]) {
      if (block.type === "text" && typeof block.text === "string") {
        out.push({ type: "assistant", summary: summarize(block.text), payload: { text: block.text } });
      } else if (block.type === "thinking" && typeof block.thinking === "string") {
        out.push({ type: "thinking", summary: summarize(block.thinking), payload: { text: block.thinking } });
      } else if (block.type === "tool_use") {
        out.push({
          type: "tool_use",
          summary: summarize(`${asString(block.name) ?? "tool"}(${JSON.stringify(block.input ?? {}).slice(0, 150)})`),
          payload: { id: asString(block.id), name: asString(block.name), input: block.input ?? {} },
        });
      }
    }
    return out;
  }
  if (type === "user" && line.message && Array.isArray(line.message.content)) {
    for (const block of line.message.content as ContentBlock[]) {
      // the CLI echoes the prompt as a user text block — the hub already
      // has it as its own session.prompt event; only tool_results matter.
      if (block.type === "tool_result") {
        const text = typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? "");
        out.push({
          type: "tool_result",
          summary: summarize(text) || "Tool fertig",
          payload: { toolUseId: asString(block.id) ?? asString(block.tool_use_id), isError: block.is_error === true, content: text },
        });
      }
    }
    return out;
  }
  if (type === "result") {
    // real shape (live 2026-09-29): camelCase usage, no cost reported
    const usage = line.usage ?? null;
    const input = typeof usage?.inputTokens === "number" ? usage.inputTokens : typeof usage?.input_tokens === "number" ? usage.input_tokens : undefined;
    const output = typeof usage?.outputTokens === "number" ? usage.outputTokens : typeof usage?.output_tokens === "number" ? usage.output_tokens : undefined;
    const cost = typeof line.total_cost_usd === "number" ? line.total_cost_usd : undefined;
    const tokens = input !== undefined && output !== undefined ? input + output : undefined;
    out.push({
      type: "system",
      summary: `cursor: Zug beendet (${asString(line.subtype) ?? "?"})`,
      payload: {
        kind: "cursor.result",
        isError: line.is_error === true,
        result: typeof line.result === "string" ? line.result.slice(0, 500) : undefined,
        ...(input !== undefined || output !== undefined ? { usage: { ...(input !== undefined ? { input } : {}), ...(output !== undefined ? { output } : {}) } } : {}),
      },
      ...(cost !== undefined ? { costUsd: cost } : {}),
      ...(tokens !== undefined ? { tokensEst: tokens } : {}),
    });
    return out;
  }
  if (type !== undefined) {
    // fail loud, once per type would be nicer — visible is the bar
    out.push({ type: "system", summary: `cursor: unbehandelter stream-json-Typ "${type}"`, payload: { kind: "cursor.unhandled", type } });
  }
  return out;
}
