import type { EmittedEvent } from "@uacc/contracts";

/**
 * Maps one parsed line of `copilot --output-format json` output to zero or
 * more EmittedEvents.
 *
 * Ground truth: three real, anonymized `copilot -p <prompt> --output-format
 * json --allow-all-tools` captures (GitHub Copilot CLI 1.0.86, already
 * authenticated on this machine, 2026-09-18) — see `test/fixtures/`:
 *   - trivial-say-ok.jsonl: no tool use, plain answer.
 *   - tool-use-read-file.jsonl: a real `view` tool call that succeeds.
 *   - tool-error-read-file.jsonl: a real `view` tool call against a missing
 *     path, real `success:false`/`error:{message,code}` shape.
 *
 * Copilot's own JSON marks transient/replaceable frames with a real,
 * observed `"ephemeral": true` field — e.g. every `assistant.message_delta`
 * / `assistant.tool_call_delta` token/arg fragment, `model.call_start`,
 * `assistant.message_start`, `assistant.idle`, and the MCP-connection
 * chatter. Each of those is superseded by a later NON-ephemeral event
 * carrying the same information in full (`assistant.message` has the
 * complete content and fully-assembled `toolRequests`; `tool.execution_*`
 * and `result` are never marked ephemeral). This adapter uses that
 * self-declared flag as the real, evidence-based signal for what to fold
 * away — not a guess about which events "seem" unimportant — so no
 * information is lost, only the redundant streaming replay of it.
 *
 * `session.usage_checkpoint`'s only real figures are cumulative
 * `totalPremiumRequests`/`totalNanoAiu` counters — no dollar cost, no
 * fraction-of-quota + resetsAt (ADR-0004's UsageQuota shape). Forcing them
 * into UsageQuota would fabricate fields that don't exist (R9.7), so they
 * are surfaced as a plain `system` event instead; capabilities() reports
 * both cost:false and usage:false accordingly.
 */

interface CopilotLine {
  type?: string;
  ephemeral?: boolean;
  data?: Record<string, unknown>;
  // Only the terminal "result" line carries these at the top level.
  sessionId?: string;
  exitCode?: number;
  usage?: {
    premiumRequests?: number;
    totalApiDurationMs?: number;
    sessionDurationMs?: number;
    codeChanges?: { linesAdded?: number; linesRemoved?: number; filesModified?: string[] };
  };
}

interface ToolRequest {
  toolCallId?: string;
  name?: string;
  arguments?: unknown;
}

function asString(v: unknown, max = 200): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? s.slice(0, max) + "…" : s;
}

export function normalizeCopilotLine(raw: unknown): EmittedEvent[] {
  if (typeof raw !== "object" || raw === null) {
    return [{ type: "system", summary: "copilot: non-object JSON line", payload: { raw: asString(raw) } }];
  }
  const line = raw as CopilotLine;

  // Real, observed self-declared "safe to fold away" signal — see doc
  // comment above. Applies to every type, not case-by-case.
  if (line.ephemeral === true) return [];

  const data = line.data ?? {};

  switch (line.type) {
    case "user.message": {
      const content = typeof data.content === "string" ? data.content : "";
      return [{ type: "user", summary: asString(content), payload: { text: content } }];
    }

    case "assistant.turn_start":
      return [
        { type: "system", summary: "copilot: turn start", payload: { kind: "copilot.turn_start", turnId: data.turnId } },
      ];

    case "assistant.turn_end":
      return [
        { type: "system", summary: "copilot: turn end", payload: { kind: "copilot.turn_end", turnId: data.turnId } },
      ];

    case "session.auto_mode_resolved":
      return [
        {
          type: "system",
          summary: `copilot: auto-routed to ${asString(data.chosenModel, 60)}`,
          payload: { kind: "copilot.model_resolved", model: data.chosenModel },
        },
      ];

    case "assistant.message": {
      const content = typeof data.content === "string" ? data.content : "";
      const toolRequests = Array.isArray(data.toolRequests) ? (data.toolRequests as ToolRequest[]) : [];
      const events: EmittedEvent[] = [];
      if (content.length > 0) {
        events.push({ type: "assistant", summary: asString(content), payload: { text: content } });
      }
      for (const req of toolRequests) {
        events.push({
          type: "tool_use",
          summary: `copilot: ${req.name ?? "tool"} ${asString(req.arguments, 80)}`,
          payload: { id: req.toolCallId, tool: req.name, input: req.arguments },
        });
      }
      if (events.length === 0) {
        events.push({
          type: "system",
          summary: "copilot: assistant.message with no content and no tool requests",
          payload: { kind: "copilot.empty_assistant_message" },
        });
      }
      return events;
    }

    case "tool.execution_complete": {
      const toolCallId = data.toolCallId;
      const success = data.success === true;
      if (success) {
        const result = data.result as { content?: string } | undefined;
        return [
          {
            type: "tool_result",
            summary: asString(result?.content ?? "", 150),
            payload: { toolUseId: toolCallId, isError: false, output: result?.content },
          },
        ];
      }
      const error = data.error as { message?: string; code?: string } | undefined;
      return [
        {
          type: "tool_result",
          summary: `copilot: tool error — ${asString(error?.message, 120)}`,
          payload: { toolUseId: toolCallId, isError: true, error: error?.message, errorCode: error?.code },
        },
      ];
    }

    case "session.usage_checkpoint":
      return [
        {
          type: "system",
          summary: `copilot: usage checkpoint — ${asString(data.totalPremiumRequests, 20)} premium request(s) this session`,
          payload: {
            kind: "copilot.usage_checkpoint",
            totalPremiumRequests: data.totalPremiumRequests,
            totalNanoAiu: data.totalNanoAiu,
          },
        },
      ];

    // `tool.execution_start` carries nothing tool.execution_complete /
    // assistant.message's toolRequests don't already have — see doc
    // comment; folded, same as the ephemeral frames, but this one is
    // real-not-ephemeral in the capture, so it's an explicit case, not
    // caught by the ephemeral check above.
    case "tool.execution_start":
      return [];

    case "result":
      return [
        {
          type: "system",
          summary: `copilot: run finished (exit ${line.exitCode ?? "?"})`,
          payload: {
            kind: "copilot.result",
            exitCode: line.exitCode,
            premiumRequests: line.usage?.premiumRequests,
            sessionDurationMs: line.usage?.sessionDurationMs,
            codeChanges: line.usage?.codeChanges,
          },
        },
      ];

    // Setup/session housekeeping seen in real captures but never
    // ephemeral:true in this CLI's own output; still real, still mapped
    // (fail-loud), just terse.
    case "session.mcp_server_status_changed":
    case "session.mcp_servers_loaded":
    case "session.tools_updated":
      return [
        {
          type: "system",
          summary: `copilot: ${line.type}`,
          payload: { kind: `copilot.${line.type}` },
        },
      ];

    default:
      // Fail loud (AGENTS.md rule 6): an unrecognized copilot event type
      // becomes a visible system event, never a silent drop.
      return [
        {
          type: "system",
          summary: `copilot: unhandled event type "${asString(line.type, 60)}"`,
          payload: { unhandledType: asString(line.type, 60), raw: asString(data, 300) },
        },
      ];
  }
}

/** Extracts the real session id from the terminal `result` line, if present
 * — the only place copilot ever reveals it. Used to drive `-r <sessionId>`
 * on the next steer(prompt) call. */
export function extractResultSessionId(raw: unknown): string | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const line = raw as CopilotLine;
  return line.type === "result" && typeof line.sessionId === "string" ? line.sessionId : undefined;
}
