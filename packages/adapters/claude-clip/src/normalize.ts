import type { EmittedEvent } from "@uacc/contracts";

/**
 * Maps one parsed line of a real Claude Code session transcript
 * (`~/.claude/projects/<cwd>/<sessionId>.jsonl`) to zero or more
 * EmittedEvents.
 *
 * Ground truth: real transcript files on this machine (CLI 2.1.263,
 * 2026-09-19/20), including this exact session's own transcript. This is a
 * DIFFERENT real format from `packages/adapters/claude/src/normalize.ts`'s
 * `claude -p --output-format stream-json` — deliberately not reused,
 * despite `assistant` sharing the same message/content-block envelope:
 *   - `user` records here can carry `message.content` as a plain STRING
 *     (the literal typed prompt) as well as a content-block array (a
 *     tool_result turn) — the live stream-json CLI mode never emits a
 *     bare string there. Real user text is exactly what this adapter's
 *     whole point is to surface, so it maps to a real `type: "user"`
 *     event, not the `stream-json`-adapter's own hack of feeding
 *     `text`-block content into a `type: "assistant"` event.
 *   - There is no `result` line here — no aggregate cost/token-usage
 *     record at all in this transcript format. `capabilities().cost` is
 *     therefore honestly `false` (see index.ts).
 *   - Several types simply don't exist in stream-json output at all:
 *     `agent-setting`, `queue-operation`, `attachment`, `atis-latch`,
 *     `last-prompt` — these are this CLI's own interactive-session
 *     bookkeeping, invisible to a `-p` one-shot run.
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

export function normalizeClaudeClipLine(raw: unknown): EmittedEvent[] {
  if (typeof raw !== "object" || raw === null) {
    return [{ type: "system", summary: "claude-clip: non-object transcript line", payload: { raw: asString(raw) } }];
  }
  const line = raw as Record<string, unknown>;

  switch (line.type) {
    case "user":
    case "assistant":
      return normalizeMessage(line);

    case "attachment": {
      const attachment = line.attachment as Record<string, unknown> | undefined;
      const kind = typeof attachment?.type === "string" ? attachment.type : "unknown";
      return [
        {
          type: "system",
          summary: `claude-clip: attachment (${kind})`,
          payload: { kind: "claude-clip.attachment", attachmentType: kind },
        },
      ];
    }

    case "queue-operation": {
      const operation = typeof line.operation === "string" ? line.operation : "unknown";
      const content = typeof line.content === "string" ? summarize(line.content) : undefined;
      return [
        {
          type: "system",
          summary: `claude-clip: prompt ${operation}${content ? ` — "${content}"` : ""}`,
          payload: { kind: "claude-clip.queue-operation", operation },
        },
      ];
    }

    // Real, purely internal interactive-CLI bookkeeping — no conversational
    // content, no state an AncientVoid session viewer could meaningfully show.
    // Deliberately skipped (not "unhandled" — recognized and judged
    // uninteresting), so a real session's tail isn't flooded with one
    // system-noise line per keystroke-adjacent internal event.
    case "agent-setting":
    case "atis-latch":
    case "last-prompt":
      return [];

    default:
      // Fail loud (AGENTS.md rule 6): an unrecognized transcript line type
      // becomes a visible system event, never a silent drop.
      return [
        {
          type: "system",
          summary: `claude-clip: unhandled transcript line type "${asString(line.type, 60)}"`,
          payload: { unhandledType: asString(line.type, 60) },
        },
      ];
  }
}

function normalizeMessage(line: Record<string, unknown>): EmittedEvent[] {
  const role = line.type as "user" | "assistant";
  const message = line.message as { content?: unknown } | undefined;
  const content = message?.content;

  if (typeof content === "string") {
    if (content.length === 0) return [];
    return [{ type: role, summary: summarize(content), payload: { text: content } }];
  }

  if (Array.isArray(content)) {
    if (content.length === 0) {
      return [{ type: "system", summary: `claude-clip: ${role} message without content blocks`, payload: { role } }];
    }
    return (content as ContentBlock[]).flatMap((block) => normalizeContentBlock(block, role));
  }

  return [{ type: "system", summary: `claude-clip: ${role} message without message.content`, payload: { role } }];
}

/** BUG-0046: Anthropic liefert den Denk-Text teils nicht (leerer Block mit Signatur). */
const THINKING_WITHHELD = "Claude hat nachgedacht — der Anbieter liefert den Text nicht";

function normalizeContentBlock(block: ContentBlock, role: "assistant" | "user"): EmittedEvent[] {
  switch (block.type) {
    case "text":
      return [{ type: role, summary: summarize(block.text ?? ""), payload: { text: block.text ?? "" } }];
    case "thinking":
      if (!block.thinking?.trim()) return [{ type: "thinking", summary: THINKING_WITHHELD, payload: { text: "", redacted: true } }];
      return [{ type: "thinking", summary: summarize(block.thinking), payload: { text: block.thinking } }];
    case "tool_use":
      return [
        {
          type: "tool_use",
          summary: summarize(`${block.name ?? "tool"}(${asString(block.input, 150)})`),
          payload: { id: block.id, name: block.name, input: block.input },
        },
      ];
    case "tool_result": {
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
          summary: `claude-clip: unhandled ${role} content block "${asString(block.type, 40)}"`,
          payload: { role, blockType: asString(block.type, 40) },
        },
      ];
  }
}
