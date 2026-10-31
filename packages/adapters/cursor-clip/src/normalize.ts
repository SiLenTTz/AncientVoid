import type { EmittedEvent } from "@ancientvoid/contracts";

/**
 * Decodes Cursor's own `cursorDiskKV` JSON blobs into EmittedEvents.
 *
 * Ground truth (T3.5, EPIC-P3 §3 "Cursor-Clip"): a real, live, actively-used
 * Cursor installation's `~/.config/Cursor/User/globalStorage/state.vscdb`
 * (SQLite, WAL mode) was inspected read-only on this machine, 2026-09-18.
 * The SCHEMA below — table/column names, JSON field names, the `_v` version
 * marker, the `type` enum, `toolFormerData`'s shape, its `status` enum
 * values — is verified against that real database (thousands of real rows
 * across dozens of real conversations). Fixture CONTENT in `test/fixtures/`
 * is deliberately synthetic (a real user's actual Cursor chat history is
 * private data that has no place in this repo) but built with a real
 * SQLite database using the exact real schema, not a hand-typed JSON blob.
 *
 * Real, load-bearing findings:
 * - `composerData:<composerId>` (in `cursorDiskKV`) is the ordered
 *   conversation index: `fullConversationHeadersOnly: [{bubbleId, type,
 *   createdAt, ...}]`. This — not row insertion order, not any per-bubble
 *   timestamp (`createdAt` is empty on most real bubbles) — is the only
 *   reliable ordering signal Cursor itself uses.
 * - Each bubble's actual content lives in a SEPARATE row,
 *   `bubbleId:<composerId>:<bubbleId>`, fetched by id from the header list.
 * - `type: 1` = user turn, `type: 2` = assistant turn (verified against
 *   thousands of real rows: 1 always paired with a "what the user typed"
 *   `text`, 2 always paired with `thinking`/`toolFormerData`/assistant
 *   `text`).
 * - A bubble's top-level `_v` field is Cursor's own format-version marker
 *   (real value observed: 3). This decoder refuses to interpret a bubble
 *   carrying an unrecognized `_v` — the K9 "Decoder hinter Interface mit
 *   Versions-Marker" requirement — rather than guess which fields still
 *   mean what after a future Cursor update changes the shape.
 * - `toolFormerData.status` real values: "completed", "error", "loading",
 *   "cancelled". `error` carries a JSON-encoded string
 *   `{clientVisibleErrorMessage, modelVisibleErrorMessage}`; `cancelled`
 *   carries no error payload at all (real, not an omission on this side).
 */

export const SUPPORTED_BUBBLE_VERSION = 3;

interface ThinkingBlock {
  text?: string;
}

interface ToolFormerData {
  toolCallId?: string;
  name?: string;
  status?: string;
  rawArgs?: string;
  params?: string;
  result?: string;
  error?: string;
}

interface Bubble {
  _v?: number;
  type?: number;
  text?: string;
  thinking?: ThinkingBlock;
  thinkingDurationMs?: number;
  toolFormerData?: ToolFormerData;
  tokenCount?: { inputTokens?: number; outputTokens?: number };
}

export interface ComposerHeaderEntry {
  bubbleId: string;
  type?: number;
}

export interface ComposerDataSummary {
  headers: ComposerHeaderEntry[];
  status?: string;
  modelName?: string;
  contextTokensUsed?: number;
  contextTokenLimit?: number;
}

function asString(v: unknown, max = 200): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function tryParseJson(text: string | undefined): unknown {
  if (typeof text !== "string" || text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Decodes a real `composerData:<id>` row into the fields this adapter
 * needs. Returns null when the expected `fullConversationHeadersOnly`
 * array is missing entirely — a real schema break, not a guessable shape. */
export function decodeComposerData(raw: unknown): ComposerDataSummary | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const rawHeaders = obj.fullConversationHeadersOnly;
  if (!Array.isArray(rawHeaders)) return null;
  const headers: ComposerHeaderEntry[] = [];
  for (const h of rawHeaders) {
    if (typeof h === "object" && h !== null && typeof (h as { bubbleId?: unknown }).bubbleId === "string") {
      const type = (h as { type?: number }).type;
      headers.push({ bubbleId: (h as { bubbleId: string }).bubbleId, ...(type !== undefined ? { type } : {}) });
    }
  }
  const modelConfig = obj.modelConfig as { modelName?: string } | undefined;
  const status = typeof obj.status === "string" ? obj.status : undefined;
  const modelName = typeof modelConfig?.modelName === "string" ? modelConfig.modelName : undefined;
  const contextTokensUsed = typeof obj.contextTokensUsed === "number" ? obj.contextTokensUsed : undefined;
  const contextTokenLimit = typeof obj.contextTokenLimit === "number" ? obj.contextTokenLimit : undefined;
  return {
    headers,
    ...(status !== undefined ? { status } : {}),
    ...(modelName !== undefined ? { modelName } : {}),
    ...(contextTokensUsed !== undefined ? { contextTokensUsed } : {}),
    ...(contextTokenLimit !== undefined ? { contextTokenLimit } : {}),
  };
}

function decodeToolFormerData(tfd: ToolFormerData): EmittedEvent[] {
  const input = tryParseJson(tfd.params) ?? tryParseJson(tfd.rawArgs);
  const events: EmittedEvent[] = [
    {
      type: "tool_use",
      summary: `cursor: ${tfd.name ?? "tool"} ${asString(input, 80)}`,
      payload: { id: tfd.toolCallId, tool: tfd.name, input },
    },
  ];

  // "loading" — the tool call is still running in the real Cursor window;
  // no result exists yet to report. Not an error, not a drop: the
  // tool_use above is still real and already emitted.
  if (tfd.status === "loading") return events;

  if (tfd.status === "completed") {
    const output = tryParseJson(tfd.result);
    events.push({
      type: "tool_result",
      summary: asString(output, 150),
      payload: { toolUseId: tfd.toolCallId, isError: false, output },
    });
    return events;
  }

  // "error" or "cancelled" (real observed values) — both are the real,
  // final terminal states other than success.
  const isCancelled = tfd.status === "cancelled";
  let error: unknown = isCancelled ? "cancelled by user" : undefined;
  if (!isCancelled) {
    const parsed = tryParseJson(tfd.error) as { clientVisibleErrorMessage?: string } | string | undefined;
    error =
      typeof parsed === "object" && parsed !== null && typeof parsed.clientVisibleErrorMessage === "string"
        ? parsed.clientVisibleErrorMessage
        : (parsed ?? "unknown error");
  }
  events.push({
    type: "tool_result",
    summary: `cursor: ${tfd.name ?? "tool"} — ${asString(error, 120)}`,
    payload: { toolUseId: tfd.toolCallId, isError: true, error },
  });
  return events;
}

/** Decodes one real `bubbleId:<composerId>:<bubbleId>` row. */
export function decodeBubble(raw: unknown): EmittedEvent[] {
  if (typeof raw !== "object" || raw === null) {
    return [{ type: "system", summary: "cursor-clip: non-object bubble JSON", payload: { raw: asString(raw) } }];
  }
  const bubble = raw as Bubble;

  if (bubble._v !== undefined && bubble._v !== SUPPORTED_BUBBLE_VERSION) {
    return [
      {
        type: "system",
        summary: `cursor-clip: unsupported bubble format version ${bubble._v} (expected ${SUPPORTED_BUBBLE_VERSION}) — Cursor may have updated its storage format`,
        payload: { kind: "cursor-clip.unsupported_version", version: bubble._v },
      },
    ];
  }

  if (bubble.type === 1) {
    const text = bubble.text ?? "";
    return [{ type: "user", summary: asString(text), payload: { text } }];
  }

  if (bubble.type === 2) {
    const events: EmittedEvent[] = [];
    const thinkingText = bubble.thinking?.text;
    if (thinkingText) {
      events.push({
        type: "thinking",
        summary: asString(thinkingText),
        payload: { text: thinkingText, durationMs: bubble.thinkingDurationMs },
      });
    }
    if (bubble.toolFormerData) {
      events.push(...decodeToolFormerData(bubble.toolFormerData));
    }
    if (bubble.text) {
      const tokens = bubble.tokenCount;
      const tokensEst = tokens && (tokens.inputTokens || tokens.outputTokens) ? (tokens.inputTokens ?? 0) + (tokens.outputTokens ?? 0) : undefined;
      events.push({
        type: "assistant",
        summary: asString(bubble.text),
        payload: { text: bubble.text },
        ...(tokensEst !== undefined ? { tokensEst } : {}),
      });
    }
    if (events.length === 0) {
      events.push({
        type: "system",
        summary: "cursor-clip: assistant bubble with no thinking, tool call or text",
        payload: { kind: "cursor-clip.empty_assistant_bubble" },
      });
    }
    return events;
  }

  return [
    {
      type: "system",
      summary: `cursor-clip: unhandled bubble type ${asString(bubble.type, 20)}`,
      payload: { kind: "cursor-clip.unhandled_bubble_type", bubbleType: bubble.type },
    },
  ];
}
