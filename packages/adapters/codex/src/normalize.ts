import { providerErrorEvent, type EmittedEvent } from "@ancientvoid/contracts";
import { estimateCostUsd } from "./pricing.ts";

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
 * No `item.type: "reasoning"` was observed in any capture
 * (`reasoning_output_tokens` was 0 in all three) — codex clearly tracks
 * reasoning tokens even when none are spent, so a reasoning item type
 * presumably exists, but its shape is UNverified here and needs a real
 * capture (T1.4) before being trusted.
 */

interface CodexItem {
  id?: string;
  type?: string;
  text?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number | null;
  status?: string;
}

function asString(v: unknown, max = 4000): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v).slice(0, max);
  } catch {
    return String(v).slice(0, max);
  }
}

export function summarize(text: string, max = 200): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + "…" : oneLine;
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
    case "item.completed": {
      const item = (line.item ?? {}) as CodexItem;
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
      // Only ever observed as item.completed (no streaming item.started
      // for message text in any capture) — an item.started for this type
      // is handled by the default branch below if it ever occurs.
      if (!completed) break;
      return [{ type: "assistant", summary: summarize(item.text ?? ""), payload: { text: item.text ?? "" } }];
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
      const isError = (item.exit_code ?? 0) !== 0;
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
  return [];
}
