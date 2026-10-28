import { closeSync, openSync, readSync } from "node:fs";

/**
 * Title and last words of a Claude Code transcript (ADR-0040). Transcripts
 * reach tens of MB, so only a head and a tail window are read — Claude
 * itself keeps `ai-title` and `last-prompt` entries current, and they sit
 * near the end. Results are cached per file version (mtime + size).
 */
export interface ClaudeTranscriptMeta {
  title: string | null;
  preview: string | null;
}

const HEAD_BYTES = 96 * 1024;
const TAIL_BYTES = 256 * 1024;
const TITLE_MAX = 80;
const PREVIEW_MAX = 160;
const CACHE_MAX = 4000;

const cache = new Map<string, { mtimeMs: number; size: number; meta: ClaudeTranscriptMeta }>();

/** Text the CLI injects as "user" turns — not something the person said. */
const WRAPPER = /^(?:<(?:command-|local-command|system-reminder|bash-|task-notification)|Caveat:|\[Request interrupted)/;

function clip(text: string, max: number): string | null {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function readWindow(path: string, position: number, length: number): string {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const read = readSync(fd, buffer, 0, length, position);
    return buffer.toString("utf8", 0, read);
  } finally {
    closeSync(fd);
  }
}

function entries(window: string, dropFirst: boolean, dropLast: boolean): Record<string, unknown>[] {
  const lines = window.split("\n");
  if (dropFirst) lines.shift();
  if (dropLast) lines.pop();
  const out: Record<string, unknown>[] = [];
  for (const line of lines) {
    if (!line.startsWith("{")) continue;
    try {
      const value = JSON.parse(line) as unknown;
      if (value && typeof value === "object") out.push(value as Record<string, unknown>);
    } catch {
      // torn line at a window edge or a corrupt line — never fatal for a title
    }
  }
  return out;
}

function userText(entry: Record<string, unknown>): string | null {
  if (entry.type !== "user" || entry.isMeta === true || entry.isSidechain === true) return null;
  const message = entry.message as { content?: unknown } | undefined;
  const content = message?.content;
  let text = "";
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    text = content
      .map((block) => (block && typeof block === "object" && (block as { type?: unknown }).type === "text" ? String((block as { text?: unknown }).text ?? "") : ""))
      .join(" ");
  }
  const trimmed = text.trim();
  return trimmed && !WRAPPER.test(trimmed) ? trimmed : null;
}

function lastOf(list: Record<string, unknown>[], type: string, key: string): string | null {
  for (let i = list.length - 1; i >= 0; i--) {
    const entry = list[i]!;
    if (entry.type === type && typeof entry[key] === "string" && entry[key]) return entry[key] as string;
  }
  return null;
}

export function extractClaudeMeta(head: Record<string, unknown>[], tail: Record<string, unknown>[]): ClaudeTranscriptMeta {
  const firstPrompt = head.map(userText).find((t) => t !== null) ?? null;
  const lastPrompt = lastOf(tail, "last-prompt", "lastPrompt") ?? tail.map(userText).filter((t) => t !== null).pop() ?? null;
  const title = lastOf(tail, "ai-title", "aiTitle") ?? lastOf(head, "ai-title", "aiTitle") ?? firstPrompt;
  return {
    title: title ? clip(title.split("\n").find((l) => l.trim()) ?? title, TITLE_MAX) : null,
    preview: lastPrompt ? clip(lastPrompt, PREVIEW_MAX) : null,
  };
}

export function readClaudeMeta(path: string, stat: { size: number; mtimeMs: number }): ClaudeTranscriptMeta {
  const hit = cache.get(path);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.meta;
  let meta: ClaudeTranscriptMeta = { title: null, preview: null };
  try {
    const headLength = Math.min(stat.size, HEAD_BYTES);
    const head = entries(readWindow(path, 0, headLength), false, stat.size > headLength);
    const tailStart = Math.max(0, stat.size - TAIL_BYTES);
    const tail =
      tailStart === 0
        ? entries(readWindow(path, 0, stat.size), false, false)
        : entries(readWindow(path, tailStart, stat.size - tailStart), true, false);
    meta = extractClaudeMeta(head, tail);
  } catch {
    // unreadable file: the row stays, just without a title (K9 — the scan reports the file itself)
  }
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, meta });
  return meta;
}
