import { z } from "zod";
import { AttachmentId } from "../attachments/attachment.ts";

/**
 * EPIC-P10.5 (ADR-0030): a video becomes working material for a session.
 * A job runs fixed steps; each writes its result as a file in the job's
 * directory, so a restarted hub continues where it stopped (AC-P10.5-3).
 * Events and API records carry state and references only (K5).
 */
export const MEDIA_STEPS = ["fetch", "probe", "audio", "frames", "vision", "merge", "summarize"] as const;
export type MediaStep = (typeof MEDIA_STEPS)[number];

export const MEDIA_STEP_LABELS: Record<MediaStep, string> = {
  fetch: "Quelle holen",
  probe: "Prüfen",
  audio: "Transkript",
  frames: "Schlüsselbilder",
  vision: "Bilder lesen",
  merge: "Zeitleiste",
  summarize: "Zusammenfassung",
};

export type MediaStepStatus = "pending" | "running" | "done" | "skipped" | "failed";

export interface MediaStepState {
  status: MediaStepStatus;
  startedAt: string | null;
  finishedAt: string | null;
  /** In words: what came out, or why it was skipped/failed. */
  detail: string | null;
  /** Who did the work: "lokal", "whisper.cpp", "Untertitel", "gemini", "yt-dlp" … */
  via: string | null;
  /** 0..1 while running, when the step can tell. */
  progress: number | null;
}

export type MediaJobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

/** Everything that left the hub, per step (AC-P10.5-2). */
export interface MediaEgress {
  step: MediaStep;
  /** Host name ("www.youtube.com", "generativelanguage.googleapis.com"). */
  service: string;
  /** Own hardware (configured STT/LLM in the tailnet) vs. a third party. */
  own: boolean;
  at: string;
}

export interface MediaLimits {
  maxDurationSec: number;
  maxBytes: number;
  maxFrames: number;
}

export const DEFAULT_MEDIA_LIMITS: MediaLimits = { maxDurationSec: 30 * 60, maxBytes: 500 * 1024 * 1024, maxFrames: 24 };

/** Felder ohne die Link-oder-Datei-Prüfung: `pick` geht nur auf dem Objekt ohne Refinement. */
export const MediaJobFields = z.object({
    url: z
      .string()
      .trim()
      .max(2000)
      .url()
      .refine((u) => /^https?:\/\//i.test(u), "nur http(s)-Links")
      .optional(),
    attachmentId: AttachmentId.optional(),
    /** Gemini may help (transcript without local STT, image descriptions, summary). Off by default. */
    allowCloud: z.boolean().default(false),
    /** Spoken language ("de", "en" …) or "auto". */
    language: z.string().regex(/^(auto|[a-z]{2})$/).default("auto"),
});
export const MediaJobRequest = MediaJobFields.refine((r) => Boolean(r.url) !== Boolean(r.attachmentId), "entweder ein Link oder eine Datei");
export type MediaJobRequest = z.infer<typeof MediaJobRequest>;

export interface MediaJob {
  id: string;
  source: { kind: "url" | "file"; url: string | null; attachmentId: string | null; name: string | null };
  title: string | null;
  durationSec: number | null;
  status: MediaJobStatus;
  steps: Record<MediaStep, MediaStepState>;
  allowCloud: boolean;
  language: string;
  limits: MediaLimits;
  egress: MediaEgress[];
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
  /** The result as a Markdown attachment — what a session gets (AC-P10.5-5). */
  resultAttachmentId: string | null;
}

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface KeyFrame {
  index: number;
  atMs: number;
  /** File name inside the job's frame directory. */
  file: string;
  /** Marked as a model's description — may be wrong (Premortem 3). */
  description: string | null;
  /** Text read from the image, kept apart from the description. */
  ocr: string | null;
  via: string | null;
}

export interface Chapter {
  startMs: number;
  title: string;
  summary: string;
}

export interface MediaResult {
  jobId: string;
  title: string;
  url: string | null;
  durationSec: number;
  language: string | null;
  transcriptVia: string | null;
  transcript: TranscriptSegment[];
  frames: KeyFrame[];
  chapters: Chapter[];
  summary: string | null;
  keyPoints: string[];
  summaryVia: string | null;
  /** What is missing and why (no model, no audio, …). */
  notes: string[];
}

export function freshSteps(): Record<MediaStep, MediaStepState> {
  return Object.fromEntries(MEDIA_STEPS.map((s) => [s, { status: "pending", startedAt: null, finishedAt: null, detail: null, via: null, progress: null }])) as Record<MediaStep, MediaStepState>;
}

/** 83_000 → "1:23", 3_723_000 → "1:02:03". */
export function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** "1:23" / "01:02:03" / "83" → milliseconds; null when unreadable. */
export function parseTimestamp(text: string): number | null {
  const parts = text.trim().split(":").map((p) => Number(p));
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0) * 1000;
}

/** A link that opens the source at a moment — YouTube knows `t=`; others get none. */
export function timestampLink(url: string | null, ms: number): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtube.com" || host === "youtu.be" || host === "music.youtube.com") {
      u.searchParams.set("t", `${Math.floor(ms / 1000)}s`);
      return u.toString();
    }
    if (host === "vimeo.com") return `${url.split("#")[0]}#t=${Math.floor(ms / 1000)}s`;
  } catch {
    return null;
  }
  return null;
}

/**
 * The result as text for a harness: summary, chapters, key frames and the
 * transcript, every line with its timestamp so an agent can cite the
 * moment. Frame paths let file-capable harnesses open the images.
 */
export function mediaResultMarkdown(r: MediaResult, framePath: (file: string) => string): string {
  const ts = (ms: number) => `[${formatTimestamp(ms)}]`;
  const lines: string[] = [`# Video: ${r.title}`, ""];
  if (r.url) lines.push(`Quelle: ${r.url}`);
  lines.push(`Dauer: ${formatTimestamp(r.durationSec * 1000)} · Sprache: ${r.language ?? "unbekannt"} · Transkript: ${r.transcriptVia ?? "keins"} · Zusammenfassung: ${r.summaryVia ?? "keine"}`, "");
  lines.push("Zeitmarken im Format [m:ss] bzw. [h:mm:ss] ab Videobeginn.", "");
  if (r.summary) lines.push("## Zusammenfassung", "", r.summary, "");
  if (r.keyPoints.length) lines.push("## Kernaussagen", "", ...r.keyPoints.map((k) => `- ${k}`), "");
  if (r.chapters.length) lines.push("## Kapitel", "", ...r.chapters.map((c) => `- ${ts(c.startMs)} **${c.title}** — ${c.summary}`), "");
  if (r.frames.length) {
    lines.push("## Schlüsselbilder", "");
    for (const f of r.frames) {
      lines.push(`- ${ts(f.atMs)} Bild: ${framePath(f.file)}`);
      if (f.description) lines.push(`  - Beschreibung (${f.via ?? "Modell"}, kann irren): ${f.description.replace(/\s+/g, " ")}`);
      if (f.ocr) lines.push(`  - Text im Bild: ${f.ocr.replace(/\s+/g, " ").slice(0, 600)}`);
    }
    lines.push("");
  }
  if (r.notes.length) lines.push("## Hinweise", "", ...r.notes.map((n) => `- ${n}`), "");
  lines.push("## Transkript", "");
  if (r.transcript.length === 0) lines.push("(kein Transkript)");
  for (const s of r.transcript) lines.push(`${ts(s.startMs)} ${s.text}`);
  return `${lines.join("\n")}\n`;
}
