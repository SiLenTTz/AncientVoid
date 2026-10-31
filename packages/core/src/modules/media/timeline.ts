import { parseTimestamp, type Chapter, type TranscriptSegment } from "@ancientvoid/contracts";

/**
 * T10.5.3/T10.5.5: pure helpers for the timeline — subtitles in, compact
 * transcript blocks, near-duplicate frames out, chapters without a model.
 */

function vttTime(text: string): number | null {
  const m = /^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})$/.exec(text.trim());
  if (!m) return null;
  return ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]);
}

function stripCue(line: string): string {
  return line
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * WebVTT → segments. YouTube's automatic captions repeat the previous line
 * in every cue (rolling captions); a line equal to the last one emitted is
 * dropped, so every spoken line appears once, at its first time.
 */
export function parseVtt(text: string): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  const blocks = text.replace(/\r/g, "").split(/\n\n+/);
  const seen: string[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const timing = lines.findIndex((l) => l.includes("-->"));
    if (timing < 0) continue;
    const [a, b] = lines[timing]!.split("-->");
    const start = vttTime(a ?? "");
    const end = vttTime((b ?? "").trim().split(/\s+/)[0] ?? "");
    if (start === null || end === null) continue;
    for (const raw of lines.slice(timing + 1)) {
      const line = stripCue(raw);
      if (!line || seen.slice(-3).includes(line)) continue;
      seen.push(line);
      out.push({ startMs: start, endMs: Math.max(end, start), text: line });
    }
  }
  return out;
}

/** Consecutive segments merged into blocks of at most `maxMs`, ending at a sentence or a pause where possible. */
export function compactSegments(segments: readonly TranscriptSegment[], maxMs = 15_000): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  let cur: TranscriptSegment | null = null;
  for (const s of segments) {
    const text = s.text.trim();
    if (!text) continue;
    // A block ends at a sentence, at the time limit or at a pause in speech.
    if (cur && s.endMs - cur.startMs <= maxMs && s.startMs - cur.endMs <= 1500 && !/[.!?…]["»”]?$/.test(cur.text)) {
      cur = { startMs: cur.startMs, endMs: Math.max(cur.endMs, s.endMs), text: `${cur.text} ${text}` };
    } else {
      if (cur) out.push(cur);
      cur = { startMs: s.startMs, endMs: s.endMs, text };
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** 9×8 grey pixels (row-major) → 64-bit difference hash. */
export function dHash(gray: Uint8Array): bigint {
  if (gray.length < 72) throw new Error("dHash braucht 9×8 Pixel");
  let hash = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      hash = (hash << 1n) | (gray[y * 9 + x]! > gray[y * 9 + x + 1]! ? 1n : 0n);
    }
  }
  return hash;
}

export function hamming(a: bigint, b: bigint): number {
  let v = a ^ b;
  let n = 0;
  while (v) {
    n += Number(v & 1n);
    v >>= 1n;
  }
  return n;
}

/**
 * Frames that look alike (hash distance ≤ `threshold`) keep only the
 * first; more than `max` are thinned evenly over the video.
 */
export function pickFrames<T extends { atMs: number; hash: bigint }>(candidates: readonly T[], max: number, threshold = 6): T[] {
  const kept: T[] = [];
  for (const c of [...candidates].sort((a, b) => a.atMs - b.atMs)) {
    if (kept.some((k) => hamming(k.hash, c.hash) <= threshold)) continue;
    kept.push(c);
  }
  if (kept.length <= max) return kept;
  const step = kept.length / max;
  return Array.from({ length: max }, (_, i) => kept[Math.floor(i * step)]!);
}

/** Without any model: blocks of ~5 minutes (at least 3), titled by their first words. */
export function timeChapters(segments: readonly TranscriptSegment[], durationMs: number): Chapter[] {
  if (segments.length === 0) return [];
  const blockMs = Math.max(60_000, Math.min(300_000, Math.ceil(durationMs / 3 / 60_000) * 60_000));
  const chapters: Chapter[] = [];
  for (const s of segments) {
    const last = chapters.at(-1);
    if (!last || s.startMs - last.startMs >= blockMs) {
      const words = s.text.split(/\s+/).slice(0, 8).join(" ");
      chapters.push({ startMs: s.startMs, title: `Abschnitt ${chapters.length + 1}`, summary: `${words}${s.text.split(/\s+/).length > 8 ? " …" : ""}` });
    }
  }
  return chapters;
}

/** Model chapters: timestamps parsed, inside the video, ascending, deduplicated. */
export function cleanChapters(raw: readonly { start?: unknown; title?: unknown; summary?: unknown }[], durationMs: number): Chapter[] {
  const out: Chapter[] = [];
  for (const c of raw) {
    const startMs = typeof c.start === "number" ? c.start * 1000 : typeof c.start === "string" ? parseTimestamp(c.start) : null;
    const title = typeof c.title === "string" ? c.title.trim().slice(0, 120) : "";
    if (startMs === null || !title || startMs > durationMs + 1000) continue;
    if (out.length && startMs <= out.at(-1)!.startMs) continue;
    out.push({ startMs, title, summary: typeof c.summary === "string" ? c.summary.trim().slice(0, 600) : "" });
  }
  return out;
}
