import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EmittedEvent } from "@uacc/contracts";

/**
 * ADR-0041: a pi session file (`<sessions>/<project>/<timestamp>_<uuid>.jsonl`) as hub events — the
 * history of an adopted session. `message` entries carry `role` user / assistant / toolResult; assistant
 * content blocks are `text`, `thinking` and `toolCall`. Verified against pi 1.4.0 files (2026-10-28).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSessionId(id: string): boolean {
  return UUID.test(id);
}

function summarize(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 200 ? `${flat.slice(0, 199)}…` : flat;
}

function str(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v) ?? "";
  } catch {
    return String(v);
  }
}

function blocksText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => (b && typeof b === "object" && (b as { type?: unknown }).type === "text" ? String((b as { text?: unknown }).text ?? "") : ""))
    .join("");
}

/** Where the session with this id lives, or null. Never builds a path from the id itself (only UUIDs are looked up). */
export function findSessionFile(sessionsDir: string, id: string): string | null {
  if (!isSessionId(id) || !existsSync(sessionsDir)) return null;
  for (const project of readdirSync(sessionsDir)) {
    try {
      const hit = readdirSync(join(sessionsDir, project)).find((f) => f.endsWith(`_${id}.jsonl`));
      if (hit) return join(sessionsDir, project, hit);
    } catch {
      // not a directory
    }
  }
  return null;
}

export function transcriptEvents(raw: string): EmittedEvent[] {
  const out: EmittedEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.startsWith("{")) continue;
    let entry: { type?: unknown; message?: { role?: unknown; content?: unknown; toolCallId?: unknown; isError?: unknown } };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const m = entry.message;
    if (entry.type !== "message" || !m) continue;
    if (m.role === "user") {
      const text = blocksText(m.content);
      if (text.trim()) out.push({ type: "user", summary: summarize(text), payload: { text } });
    } else if (m.role === "assistant" && Array.isArray(m.content)) {
      for (const block of m.content as { type?: unknown; text?: unknown; thinking?: unknown; id?: unknown; name?: unknown; arguments?: unknown }[]) {
        if (block.type === "text" && String(block.text ?? "").trim()) {
          out.push({ type: "assistant", summary: summarize(String(block.text)), payload: { text: String(block.text) } });
        } else if (block.type === "thinking") {
          const text = String(block.thinking ?? "");
          out.push(
            text.trim()
              ? { type: "thinking", summary: summarize(text), payload: { text } }
              : { type: "thinking", summary: "pi hat nachgedacht — der Anbieter liefert den Text nicht", payload: { text: "", redacted: true } },
          );
        } else if (block.type === "toolCall") {
          const name = String(block.name ?? "tool");
          out.push({ type: "tool_use", summary: summarize(`${name}(${str(block.arguments).slice(0, 150)})`), payload: { id: block.id, name, input: block.arguments } });
        }
      }
    } else if (m.role === "toolResult") {
      const content = blocksText(m.content);
      const isError = m.isError === true;
      out.push({ type: "tool_result", summary: summarize(content) || (isError ? "tool error" : "tool result"), payload: { toolUseId: m.toolCallId, isError, content } });
    }
  }
  return out;
}

export function readTranscript(file: string): EmittedEvent[] {
  return transcriptEvents(readFileSync(file, "utf8"));
}
