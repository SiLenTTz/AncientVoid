import type { EmittedEvent } from "@uacc/contracts";

/**
 * Maps one parsed line of `claude --output-format stream-json` output to
 * zero or more EmittedEvents.
 *
 * Ground truth: two real `claude -p <prompt> --output-format stream-json
 * --verbose` captures (CLI 2.1.263, 2026-09-14) — see `test/fixtures/`, not
 * the simplified table in `epics/EPIC-P1-claude-codex-monitor.md` §3, which
 * undersold the real shape (no `hook_started`/`hook_response`/
 * `rate_limit_event`; `assistant`/`user` carry content-block arrays, not
 * flat `tool_use`/`tool_result` top-level types). `thinking` content blocks
 * were NOT observed in either capture (no extended-thinking run) — that
 * branch is modeled on the public Messages API content-block shape and
 * needs confirming against a real fixture (T1.4) before being trusted.
 */

interface ContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

function asString(v: unknown, max = 4000): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v).slice(0, max);
  } catch {
    return String(v).slice(0, max);
  }
}

function summarize(text: string, max = 200): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + "…" : oneLine;
}

export function normalizeClaudeLine(raw: unknown): EmittedEvent[] {
  if (typeof raw !== "object" || raw === null) {
    return [
      { type: "system", summary: "claude: non-object stream-json line", payload: { raw: asString(raw) } },
    ];
  }
  const line = raw as Record<string, unknown>;

  switch (line.type) {
    case "system":
      return [normalizeSystem(line)];
    case "rate_limit_event":
      return [
        { type: "system", summary: "claude: rate-limit status update", payload: { info: line.rate_limit_info } },
      ];
    case "result":
      return [normalizeResult(line)];
    case "assistant":
    case "user": {
      const message = line.message as { content?: ContentBlock[] } | undefined;
      const blocks = Array.isArray(message?.content) ? message!.content! : [];
      if (blocks.length === 0) {
        return [
          {
            type: "system",
            summary: `claude: ${line.type} message without content blocks`,
            payload: { role: line.type },
          },
        ];
      }
      return blocks.flatMap((block) => normalizeContentBlock(block, line.type as "assistant" | "user"));
    }
    default:
      // Fail loud (AGENTS.md rule 6): an unrecognized stream-json type
      // becomes a visible system event, never a silent drop.
      return [
        {
          type: "system",
          summary: `claude: unhandled stream-json type "${asString(line.type, 60)}"`,
          payload: { unhandledType: asString(line.type, 60) },
        },
      ];
  }
}

function normalizeSystem(line: Record<string, unknown>): EmittedEvent {
  const subtype = typeof line.subtype === "string" ? line.subtype : "unknown";
  const payload: Record<string, unknown> = { subtype };
  if (subtype === "init") {
    payload.cwd = line.cwd;
    payload.claudeCodeVersion = line.claude_code_version;
    payload.toolCount = Array.isArray(line.tools) ? line.tools.length : undefined;
  } else {
    for (const key of ["hook_name", "hook_event", "outcome", "exit_code"] as const) {
      if (key in line) payload[key] = line[key];
    }
  }
  return { type: "system", summary: `claude: system/${subtype}`, payload };
}

function normalizeResult(line: Record<string, unknown>): EmittedEvent {
  const costUsd = typeof line.total_cost_usd === "number" ? line.total_cost_usd : undefined;
  const isError = line.is_error === true;
  const costSuffix = costUsd !== undefined ? ` — $${costUsd.toFixed(4)}` : "";
  return {
    type: "system",
    summary: `claude: turn complete${isError ? " (error)" : ""}${costSuffix}`,
    payload: {
      kind: "claude.result",
      isError,
      numTurns: line.num_turns,
      durationMs: line.duration_ms,
      totalCostUsd: costUsd,
      result: typeof line.result === "string" ? line.result.slice(0, 500) : undefined,
    },
  };
}

function normalizeContentBlock(block: ContentBlock, role: "assistant" | "user"): EmittedEvent[] {
  switch (block.type) {
    case "text":
      return [{ type: "assistant", summary: summarize(block.text ?? ""), payload: { text: block.text ?? "" } }];
    case "thinking":
      return [
        {
          type: "thinking",
          summary: summarize(block.thinking ?? "(thinking)"),
          payload: { text: block.thinking ?? "" },
        },
      ];
    case "tool_use":
      return [
        {
          type: "tool_use",
          summary: summarize(`${block.name ?? "tool"}(${asString(block.input, 150)})`),
          payload: { id: block.id, name: block.name, input: block.input },
        },
      ];
    case "tool_result": {
      // K5 (payload <= 4 KB) is enforced by EventStore.append() itself —
      // the adapter emits the full content and lets the hub offload it to
      // a blob if needed, rather than duplicating that policy here.
      const content = asString(block.content, 100_000);
      return [
        {
          type: "tool_result",
          summary: summarize(content) || (block.is_error ? "tool error" : "tool result"),
          payload: { toolUseId: block.tool_use_id, isError: block.is_error === true, content },
        },
      ];
    }
    default:
      return [
        {
          type: "system",
          summary: `claude: unhandled ${role} content block "${asString(block.type, 40)}"`,
          payload: { role, blockType: asString(block.type, 40) },
        },
      ];
  }
}
