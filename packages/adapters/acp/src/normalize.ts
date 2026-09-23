import type { EmittedEvent } from "@uacc/contracts";

/**
 * ACP `session/update` → NormalizedEvents (schema: @agentclientprotocol/sdk
 * 1.5.0, PROTOCOL_VERSION 1). Text arrives in chunks; one chat message per
 * agent message, not one event per token (K8). Plans map onto the todo shape
 * the run strip already reads (`todowrite`).
 */

interface ContentBlock {
  type?: string;
  text?: string;
}

interface ToolCallContent {
  type?: string;
  content?: ContentBlock;
  path?: string;
}

export interface SessionUpdate {
  sessionUpdate?: string;
  content?: ContentBlock | ToolCallContent[];
  messageId?: string | null;
  toolCallId?: string;
  title?: string | null;
  name?: string | null;
  kind?: string | null;
  status?: string | null;
  rawInput?: unknown;
  rawOutput?: unknown;
  entries?: { content?: string; status?: string; priority?: string }[];
  message?: string;
}

function summarize(text: string, max = 200): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

function toolResultText(update: SessionUpdate): string {
  const parts: string[] = [];
  if (Array.isArray(update.content)) {
    for (const c of update.content) {
      if (c.type === "content" && c.content?.type === "text" && c.content.text) parts.push(c.content.text);
      else if (c.type === "diff" && c.path) parts.push(`Änderung: ${c.path}`);
      else if (c.type === "terminal") parts.push("(Terminal-Ausgabe)");
    }
  }
  if (parts.length === 0 && update.rawOutput !== undefined) {
    parts.push(typeof update.rawOutput === "string" ? update.rawOutput : JSON.stringify(update.rawOutput));
  }
  return parts.join("\n");
}

export class UpdateMapper {
  private text = "";
  private thought = "";
  private readonly toolNames = new Map<string, string>();
  private readonly unknownSeen = new Set<string>();
  private readonly label: string;

  constructor(label: string) {
    this.label = label;
  }

  /** Buffered text as events — call before anything else is emitted and at turn end. */
  flush(): EmittedEvent[] {
    const out: EmittedEvent[] = [];
    if (this.thought) out.push({ type: "thinking", summary: summarize(this.thought) || "(denkt)", payload: { text: this.thought } });
    if (this.text) out.push({ type: "assistant", summary: summarize(this.text), payload: { text: this.text } });
    this.thought = "";
    this.text = "";
    return out;
  }

  map(update: SessionUpdate): EmittedEvent[] {
    const kind = update.sessionUpdate ?? "";
    const block = !Array.isArray(update.content) ? update.content : undefined;
    switch (kind) {
      case "agent_message_chunk":
        if (this.thought) {
          const out = this.flush();
          this.text += block?.text ?? "";
          return out;
        }
        this.text += block?.text ?? "";
        return [];
      case "agent_thought_chunk":
        this.thought += block?.text ?? "";
        return [];
      case "tool_call": {
        const name = update.name ?? update.title ?? update.kind ?? "tool";
        if (update.toolCallId) this.toolNames.set(update.toolCallId, name);
        const input = update.rawInput && typeof update.rawInput === "object" ? update.rawInput : { title: update.title ?? name };
        return [
          ...this.flush(),
          { type: "tool_use", summary: summarize(`${name}(${JSON.stringify(input).slice(0, 150)})`), payload: { id: update.toolCallId, name, input, kind: update.kind ?? null } },
        ];
      }
      case "tool_call_update": {
        if (update.status !== "completed" && update.status !== "failed") return [];
        const content = toolResultText(update);
        return [
          ...this.flush(),
          {
            type: "tool_result",
            summary: summarize(content) || (update.status === "failed" ? "Tool-Fehler" : "Tool fertig"),
            payload: { toolUseId: update.toolCallId, name: update.toolCallId ? this.toolNames.get(update.toolCallId) : undefined, isError: update.status === "failed", content },
          },
        ];
      }
      case "plan":
        return [
          ...this.flush(),
          {
            type: "tool_use",
            summary: `Plan: ${(update.entries ?? []).filter((e) => e.status === "completed").length}/${(update.entries ?? []).length} erledigt`,
            payload: { name: "todowrite", input: { todos: (update.entries ?? []).map((e) => ({ content: e.content, status: e.status })) }, source: "acp.plan" },
          },
        ];
      case "notice":
        return [{ type: "system", summary: summarize(`${this.label}: ${update.message ?? "Hinweis"}`), payload: { kind: "acp.notice" } }];
      case "user_message_chunk":
      case "available_commands_update":
      case "current_mode_update":
      case "config_option_update":
      case "session_info_update":
      case "usage_update":
      case "plan_update":
      case "plan_removed":
      case "compaction_update":
      case "compaction_summary_chunk":
        return [];
      default:
        // Fail loud, once per kind: a new update type is visible, not dropped.
        if (this.unknownSeen.has(kind)) return [];
        this.unknownSeen.add(kind);
        return [{ type: "system", summary: `${this.label}: unbekanntes ACP-Update "${kind.slice(0, 60)}"`, payload: { kind: "acp.unhandled_update", update: kind.slice(0, 60) } }];
    }
  }
}
