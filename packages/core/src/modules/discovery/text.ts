import { closeSync, openSync, readSync } from "node:fs";

/** One line of whitespace-collapsed text, cut at `max` characters; null when empty. */
export function clip(text: string, max: number): string | null {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** `length` bytes of a file from `position`, as text. */
export function readWindow(path: string, position: number, length: number): string {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const read = readSync(fd, buffer, 0, length, position);
    return buffer.toString("utf8", 0, read);
  } finally {
    closeSync(fd);
  }
}

/** JSON-lines of a window. The first line is dropped when the window starts mid-file, the last when it ends mid-file;
 * a corrupt line is skipped, never fatal for a title. */
export function jsonLines(window: string, dropFirst: boolean, dropLast: boolean): Record<string, unknown>[] {
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
      // torn line at a window edge or a corrupt line
    }
  }
  return out;
}

export interface FileWindows {
  head: Record<string, unknown>[];
  tail: Record<string, unknown>[];
}

/** Head and tail of a (possibly huge) JSONL file — whole file when it is small. */
export function headAndTail(path: string, size: number, headBytes: number, tailBytes: number): FileWindows {
  const headLength = Math.min(size, headBytes);
  const head = jsonLines(readWindow(path, 0, headLength), false, size > headLength);
  const tailStart = Math.max(0, size - tailBytes);
  const tail = tailStart === 0 ? jsonLines(readWindow(path, 0, size), false, false) : jsonLines(readWindow(path, tailStart, size - tailStart), true, false);
  return { head, tail };
}

/** Whether an allowed-roots policy hides `project` (ADR-0011: other people's sessions). No roots = nothing hidden. */
export function outsideRoots(project: string, roots: readonly string[]): boolean {
  return roots.length > 0 && !roots.some((root) => project === root || project.startsWith(`${root}/`));
}

/** Text of a chat message `content`: a string or text blocks. */
export function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (block && typeof block === "object" && (block as { type?: unknown }).type === "text" ? String((block as { text?: unknown }).text ?? "") : ""))
    .join(" ");
}
