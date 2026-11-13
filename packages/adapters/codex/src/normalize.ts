import { providerErrorEvent, type EmittedEvent } from "@ancientvoid/contracts";
import { estimateCostUsd } from "./pricing.ts";
import { itemCompleted, itemStarted, planEvent, type CodexItem as ServerItem } from "./app-server-events.ts";
import { summarize } from "./summary.ts";
export { summarize } from "./summary.ts";

/**
 * Maps one parsed line of `codex exec --json` output to zero or more
 * EmittedEvents.
 *
 * Ground truth: three real `codex exec --json` captures (codex-cli
 * 0.153.4, 2026-09-15) — see `test/fixtures/`: a trivial text turn, a
 * turn that runs a shell command, and a `resume` turn. Codex's shape is
 * structurally different from claude's (see adapter-claude/src/normalize.ts):
 * a flat `type` per line (`thread.started`, `turn.started`,
 * `item.started`/`item.completed` with an `item.type`, `turn.completed`),
 * no content-block arrays. No native cost figure anywhere in `usage` —
 * matches EPIC-P1 §3's own note that codex needs its own price table
 * (T1.11, see pricing.ts), unlike claude's `total_cost_usd`.
 *
 * Weitere Item-Shapes: offizielles Exec-Protokoll, abgeglichen am 13.11.2026:
 * https://github.com/openai/codex/blob/main/codex-rs/exec/src/exec_events.rs
 */

interface CodexItem {
  id?: string;
  type?: string;
  text?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number | null;
  status?: string;
  server?: string;
  tool?: string;
  arguments?: unknown;
  result?: unknown;
  error?: unknown;
  changes?: { path: string; kind?: unknown }[];
  query?: string;
  results?: unknown;
  prompt?: string;
  agents_states?: Record<string, unknown>;
  items?: { text: string; completed: boolean }[];
  message?: string;
}

function asString(v: unknown, max = 4000): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v).slice(0, max);
  } catch {
    return String(v).slice(0, max);
  }
}

export function normalizeCodexLine(raw: unknown, model?: string): EmittedEvent[] {
  if (typeof raw !== "object" || raw === null) {
    return [{ type: "system", summary: "codex: non-object stream-json line", payload: { raw: asString(raw) } }];
  }
  const line = raw as Record<string, unknown>;

  switch (line.type) {
    case "thread.started":
      return [
        {
          type: "system",
          summary: "codex: thread started",
          payload: { threadId: line.thread_id },
        },
      ];
    case "turn.started":
      return [{ type: "system", summary: "codex: turn started", payload: {} }];
    case "turn.completed": {
      const usage = (line.usage ?? {}) as Record<string, unknown>;
      const normalizedUsage = {
        inputTokens: usage.input_tokens as number | undefined,
        cachedInputTokens: usage.cached_input_tokens as number | undefined,
        outputTokens: usage.output_tokens as number | undefined,
        reasoningOutputTokens: usage.reasoning_output_tokens as number | undefined,
      };
      // No native cost in codex's own stream — unlike claude's
      // total_cost_usd. T1.11: our own price table, keyed by the model the
      // session actually requested (spec.model -> --model). costUsd stays
      // unset (never a guess) when the session didn't request a model, or
      // requested one pricing.ts doesn't have a rate for (R9.7-Regel).
      const costUsd = estimateCostUsd(model, normalizedUsage);
      return [
        {
          type: "system",
          summary: "codex: turn complete",
          ...(costUsd !== undefined ? { costUsd, costSource: "estimated" as const } : {}),
          payload: {
            kind: "codex.turn_complete",
            usage: normalizedUsage,
            model: model ?? null,
            costEstimated: costUsd !== undefined,
          },
        },
      ];
    }
    case "item.started":
    case "item.updated":
    case "item.completed": {
      const item = (line.item ?? {}) as CodexItem;
      if (item.type === "todo_list") return [planEvent((item.items ?? []).map((entry) => ({ step: entry.text, status: entry.completed ? "completed" : "pending" })))];
      // Updates sind Zwischenstände, kein zweiter Aufruf desselben Werkzeugs.
      if (line.type === "item.updated" && ["agent_message", "reasoning", "command_execution", "file_change", "mcp_tool_call", "collab_tool_call", "web_search"].includes(item.type ?? "")) return [];
      return normalizeItem(item, line.type === "item.completed");
    }
    case "turn.failed":
    case "error": {
      // ADR-0015: {"type":"turn.failed","error":{"message"}} / {"type":"error","message"}
      const nested = (line.error as { message?: unknown } | undefined)?.message;
      const message = typeof nested === "string" ? nested : typeof line.message === "string" ? line.message : "";
      return [providerErrorEvent("codex", message)];
    }

    default:
      // Fail loud (AGENTS.md rule 6): an unrecognized top-level type
      // becomes a visible system event, never a silent drop.
      return [
        {
          type: "system",
          summary: `codex: unhandled stream-json type "${asString(line.type, 60)}"`,
          payload: { unhandledType: asString(line.type, 60) },
        },
      ];
  }
}

function normalizeItem(item: CodexItem, completed: boolean): EmittedEvent[] {
  switch (item.type) {
    case "agent_message":
      // Zwischenstände nicht als zusätzliche Antwortzeilen duplizieren.
      if (!completed) return [];
      return [{ type: "assistant", summary: summarize(item.text ?? ""), payload: { text: item.text ?? "" } }];
    case "reasoning":
      return completed && item.text?.trim() ? [{ type: "thinking", summary: summarize(item.text), payload: { text: item.text } }] : [];
    case "file_change":
    case "mcp_tool_call":
    case "collab_tool_call":
    case "web_search": {
      const types = { file_change: "fileChange", mcp_tool_call: "mcpToolCall", collab_tool_call: "collabAgentToolCall", web_search: "webSearch" };
      const mapped: ServerItem = { ...item, type: types[item.type], ...(item.agents_states ? { agentsStates: item.agents_states } : {}), result: item.results ?? item.result };
      // Exec emittiert Dateiänderungen ausschließlich als Completed-Item.
      if (item.type === "file_change") return completed ? [...itemStarted(mapped), ...itemCompleted(mapped)] : [];
      return completed ? itemCompleted(mapped) : itemStarted(mapped);
    }
    case "error":
      return completed ? [{ type: "error", summary: summarize(item.message ?? "Codex-Fehler"), payload: { message: item.message ?? "", itemId: item.id } }] : [];
    case "command_execution": {
      if (!completed) {
        return [
          {
            type: "tool_use",
            summary: summarize(`exec: ${item.command ?? ""}`),
            payload: { id: item.id, command: item.command },
          },
        ];
      }
      const output = item.aggregated_output ?? "";
      const isError = item.status === "failed" || item.status === "declined" || (item.exit_code ?? 0) !== 0;
      return [
        {
          type: "tool_result",
          summary: summarize(output) || (isError ? "command failed" : "command completed"),
          payload: { toolUseId: item.id, isError, exitCode: item.exit_code, content: output },
        },
      ];
    }
    default:
      return [
        {
          type: "system",
          summary: `codex: unhandled item type "${asString(item.type, 40)}" (${completed ? "completed" : "started"})`,
          payload: { itemType: asString(item.type, 40), completed },
        },
      ];
  }
}
