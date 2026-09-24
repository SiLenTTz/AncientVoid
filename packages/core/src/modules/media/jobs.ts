import { randomBytes } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import {
  DEFAULT_MEDIA_LIMITS,
  formatTimestamp,
  freshSteps,
  mediaResultMarkdown,
  MEDIA_STEPS,
  type KeyFrame,
  type MediaEgress,
  type MediaJob,
  type MediaJobRequest,
  type MediaLimits,
  type MediaResult,
  type MediaStep,
  type TranscriptSegment,
} from "@uacc/contracts";
import type { HubDatabase } from "../../platform/index.ts";
import type { AttachmentStore } from "../attachments/store.ts";
import { chatJson, describeFrameGemini, describeFrameOpenAi, GEMINI_HOST, geminiJson, hostOf, transcribeGemini, whisperSegments, type FrameReading, type GeminiModel, type OpenAiModel, type WhisperServer } from "./models.ts";
import { cleanChapters, compactSegments, dHash, parseVtt, pickFrames, timeChapters } from "./timeline.ts";
import { checkMediaUrl, runTool, type ToolRunner } from "./tools.ts";

/**
 * EPIC-P10.5 (ADR-0030): media jobs. One job at a time; every step writes
 * its result into `<dir>/<id>/` and the job record says which steps are
 * done — after a restart the job continues at the first unfinished step
 * (AC-P10.5-3). The raw video is deleted when the job ends; transcript,
 * key frames and the result stay (AC-P10.5-4).
 */
export interface MediaJobsOptions {
  dir: string;
  attachments: AttachmentStore;
  /** whisper-server for speech (P10, ADR-0028). */
  stt?: WhisperServer | undefined;
  /** Local model for chapters and summary (llama.cpp). */
  summaryModel?: OpenAiModel | undefined;
  /** Local vision model (llama.cpp with mmproj) for frame descriptions. */
  vision?: OpenAiModel | undefined;
  /** Gemini — used only by jobs that allow the cloud. */
  gemini?: () => GeminiModel | undefined;
  run?: ToolRunner;
  ytDlp?: string;
  keepSource?: boolean;
  limits?: Partial<MediaLimits>;
  tessdataDir?: string | undefined;
  log?: (message: string, meta?: Record<string, unknown>) => void;
}

interface FetchMeta {
  title: string | null;
  durationSec: number | null;
  url: string | null;
  subtitles: "Untertitel" | "automatische Untertitel" | null;
  language: string | null;
}

interface Probe {
  durationSec: number;
  hasAudio: boolean;
  hasVideo: boolean;
}

interface StoredTranscript {
  segments: TranscriptSegment[];
  via: string | null;
  language: string | null;
}

type StepOutcome = { detail: string; via?: string | null; skipped?: boolean };

const CHUNK_SEC = 600;
const SUMMARY_PART_CHARS = 40_000;

const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    keyPoints: { type: "array", items: { type: "string" }, maxItems: 8 },
    chapters: {
      type: "array",
      maxItems: 12,
      items: { type: "object", properties: { start: { type: "string" }, title: { type: "string" }, summary: { type: "string" } }, required: ["start", "title", "summary"] },
    },
  },
  required: ["summary", "keyPoints", "chapters"],
};

const SYSTEM = "Du fasst Videos für Entwickler zusammen. Nutze nur, was im Material steht; erfinde nichts. Antworte auf Deutsch und nur mit JSON.";

function now(): string {
  return new Date().toISOString();
}

/**
 * OCR on camera frames reads noise ("p ! .' | 3 . L b"): a line stays only
 * when at least half of its tokens look like words (messlauf 2026-09-24).
 */
export function cleanOcr(text: string | null | undefined): string | null {
  const lines = (text ?? "")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l) => {
      const tokens = l.split(" ").filter(Boolean);
      const words = tokens.filter((w) => /^[\p{L}][\p{L}\p{N}.\-']{2,}[.,:;!?]?$/u.test(w)).length;
      return words >= 2 && words / tokens.length >= 0.5;
    });
  const t = lines.join("\n").trim();
  return t.replace(/[^\p{L}\p{N}]/gu, "").length >= 8 ? t.slice(0, 2000) : null;
}

export class MediaJobs {
  private readonly db: HubDatabase;
  private readonly opts: MediaJobsOptions;
  private readonly run: ToolRunner;
  private readonly limits: MediaLimits;
  private readonly queue: string[] = [];
  private readonly controllers = new Map<string, AbortController>();
  private worker: Promise<void> | null = null;

  constructor(db: HubDatabase, opts: MediaJobsOptions) {
    this.db = db;
    this.opts = opts;
    this.run = opts.run ?? runTool;
    this.limits = { ...DEFAULT_MEDIA_LIMITS, ...opts.limits };
  }

  jobDir(id: string): string {
    return join(this.opts.dir, id);
  }

  framePath(id: string, file: string): string | null {
    return /^frame_\d{4}\.jpg$/.test(file) ? join(this.jobDir(id), "frames", file) : null;
  }

  get(id: string): MediaJob | undefined {
    const row = this.db.prepare("SELECT state FROM media_jobs WHERE id = ?").get(id) as { state: string } | undefined;
    return row ? (JSON.parse(row.state) as MediaJob) : undefined;
  }

  list(limit = 50): MediaJob[] {
    return (this.db.prepare("SELECT state FROM media_jobs ORDER BY created_at DESC LIMIT ?").all(limit) as { state: string }[]).map((r) => JSON.parse(r.state) as MediaJob);
  }

  async result(id: string): Promise<MediaResult | null> {
    return readFile(join(this.jobDir(id), "result.json"), "utf8")
      .then((t) => JSON.parse(t) as MediaResult)
      .catch(() => null);
  }

  /** A link or an existing attachment. Throws in words when the request can't run. */
  async create(req: MediaJobRequest): Promise<MediaJob> {
    if (req.url) {
      const bad = checkMediaUrl(req.url);
      if (bad) throw new Error(bad);
    }
    let name: string | null = null;
    if (req.attachmentId) {
      const a = this.opts.attachments.get(req.attachmentId);
      if (!a) throw new Error("Anhang unbekannt — bitte erneut hochladen.");
      if (a.kind !== "video" && a.kind !== "audio") throw new Error("Der Anhang ist kein Video und keine Tonaufnahme.");
      name = a.name;
    }
    const job = this.newJob({ kind: req.url ? "url" : "file", url: req.url ?? null, attachmentId: req.attachmentId ?? null, name }, req);
    await mkdir(this.jobDir(job.id), { recursive: true, mode: 0o700 });
    if (req.attachmentId) await copyFile(this.opts.attachments.pathOf(req.attachmentId), join(this.jobDir(job.id), `source${extname(name ?? "") || ".bin"}`));
    this.insert(job);
    this.enqueue(job.id);
    return job;
  }

  /** An uploaded file (already on disk, e.g. streamed by the route) becomes the job's source. */
  async createFromFile(file: string, name: string, req: Pick<MediaJobRequest, "allowCloud" | "language">): Promise<MediaJob> {
    const job = this.newJob({ kind: "file", url: null, attachmentId: null, name }, { allowCloud: req.allowCloud, language: req.language });
    await mkdir(this.jobDir(job.id), { recursive: true, mode: 0o700 });
    await rename(file, join(this.jobDir(job.id), `source${extname(name).toLowerCase().replace(/[^.a-z0-9]/g, "") || ".bin"}`));
    this.insert(job);
    this.enqueue(job.id);
    return job;
  }

  /** Where an upload is streamed to before it becomes a job. */
  async uploadTarget(): Promise<string> {
    await mkdir(join(this.opts.dir, "uploads"), { recursive: true, mode: 0o700 });
    return join(this.opts.dir, "uploads", randomBytes(8).toString("hex"));
  }

  get maxBytes(): number {
    return this.limits.maxBytes;
  }

  cancel(id: string): MediaJob | undefined {
    const job = this.get(id);
    if (!job) return undefined;
    if (job.status === "queued" || job.status === "running") {
      this.controllers.get(id)?.abort();
      const i = this.queue.indexOf(id);
      if (i >= 0) this.queue.splice(i, 1);
      const steps = { ...job.steps };
      for (const s of MEDIA_STEPS) if (steps[s].status === "running") steps[s] = { ...steps[s], status: "failed", detail: "abgebrochen", finishedAt: now() };
      this.save({ ...job, steps, status: "cancelled", finishedAt: now(), error: "Abgebrochen." });
      if (!this.controllers.has(id)) void this.cleanup(id);
    }
    return this.get(id);
  }

  async remove(id: string): Promise<boolean> {
    const job = this.get(id);
    if (!job) return false;
    if (job.status === "running" || job.status === "queued") this.cancel(id);
    await this.worker?.catch(() => undefined);
    this.db.prepare("DELETE FROM media_jobs WHERE id = ?").run(id);
    await rm(this.jobDir(id), { recursive: true, force: true });
    return true;
  }

  /** After a restart: unfinished jobs continue at their first unfinished step. */
  resume(): number {
    const open = (this.db.prepare("SELECT state FROM media_jobs ORDER BY created_at").all() as { state: string }[]).map((r) => JSON.parse(r.state) as MediaJob).filter((j) => j.status === "queued" || j.status === "running");
    for (const job of open) {
      const steps = { ...job.steps };
      for (const s of MEDIA_STEPS) if (steps[s].status === "running") steps[s] = { ...steps[s], status: "pending", detail: "nach Neustart fortgesetzt", progress: null };
      this.save({ ...job, steps, status: "queued" });
      this.enqueue(job.id);
    }
    return open.length;
  }

  /** Tests: wait until the queue is empty. */
  async idle(): Promise<void> {
    while (this.worker) await this.worker;
  }

  private newJob(source: MediaJob["source"], req: Pick<MediaJobRequest, "allowCloud" | "language">): MediaJob {
    return {
      id: `m_${randomBytes(6).toString("hex")}`,
      source,
      title: source.name,
      durationSec: null,
      status: "queued",
      steps: freshSteps(),
      allowCloud: req.allowCloud,
      language: req.language,
      limits: this.limits,
      egress: [],
      createdAt: now(),
      finishedAt: null,
      error: null,
      resultAttachmentId: null,
    };
  }

  private insert(job: MediaJob): void {
    this.db.prepare("INSERT INTO media_jobs (id, created_at, state) VALUES (?, ?, ?)").run(job.id, job.createdAt, JSON.stringify(job));
  }

  private save(job: MediaJob): void {
    this.db.prepare("UPDATE media_jobs SET state = ? WHERE id = ?").run(JSON.stringify(job), job.id);
  }

  private patch(id: string, fn: (job: MediaJob) => MediaJob): MediaJob {
    const next = fn(this.get(id)!);
    this.save(next);
    return next;
  }

  private enqueue(id: string): void {
    if (!this.queue.includes(id)) this.queue.push(id);
    if (!this.worker) {
      this.worker = (async () => {
        while (this.queue.length) {
          const next = this.queue.shift()!;
          await this.process(next).catch((err: unknown) => this.opts.log?.("media job crashed", { id: next, error: String(err) }));
        }
      })().finally(() => {
        this.worker = null;
      });
    }
  }

  private egress(id: string, step: MediaStep, url: string, own: boolean): void {
    const service = url.includes("://") ? hostOf(url) : url;
    this.patch(id, (j) => (j.egress.some((e) => e.step === step && e.service === service) ? j : { ...j, egress: [...j.egress, { step, service, own, at: now() } as MediaEgress] }));
  }

  private progress(id: string, step: MediaStep, progress: number, detail?: string): void {
    this.patch(id, (j) => ({ ...j, steps: { ...j.steps, [step]: { ...j.steps[step], progress: Math.max(0, Math.min(1, progress)), ...(detail ? { detail } : {}) } } }));
  }

  private async process(id: string): Promise<void> {
    const job = this.get(id);
    if (!job || job.status === "cancelled") return;
    const controller = new AbortController();
    this.controllers.set(id, controller);
    const signal = controller.signal;
    this.patch(id, (j) => ({ ...j, status: "running" }));
    const steps: [MediaStep, (j: MediaJob) => Promise<StepOutcome>, boolean][] = [
      ["fetch", (j) => this.fetchStep(j, signal), true],
      ["probe", (j) => this.probeStep(j, signal), true],
      ["audio", (j) => this.audioStep(j, signal), false],
      ["frames", (j) => this.framesStep(j, signal), false],
      ["vision", (j) => this.visionStep(j, signal), false],
      ["merge", (j) => this.mergeStep(j), true],
      ["summarize", (j) => this.summarizeStep(j, signal), false],
    ];
    try {
      for (const [step, fn, fatal] of steps) {
        const current = this.get(id)!;
        if (current.status === "cancelled") return;
        if (current.steps[step].status === "done" || current.steps[step].status === "skipped") continue;
        this.patch(id, (j) => ({ ...j, steps: { ...j.steps, [step]: { status: "running", startedAt: now(), finishedAt: null, detail: j.steps[step].detail, via: null, progress: null } } }));
        try {
          const out = await fn(this.get(id)!);
          this.patch(id, (j) => ({ ...j, steps: { ...j.steps, [step]: { ...j.steps[step], status: out.skipped ? "skipped" : "done", finishedAt: now(), detail: out.detail, via: out.via ?? null, progress: out.skipped ? null : 1 } } }));
        } catch (err) {
          if (signal.aborted) return;
          const message = err instanceof Error ? err.message : String(err);
          this.patch(id, (j) => ({ ...j, steps: { ...j.steps, [step]: { ...j.steps[step], status: "failed", finishedAt: now(), detail: message.slice(0, 400) } } }));
          if (fatal) {
            this.patch(id, (j) => ({ ...j, status: "failed", finishedAt: now(), error: message.slice(0, 400) }));
            return;
          }
        }
      }
      this.patch(id, (j) => ({ ...j, status: "done", finishedAt: now() }));
    } finally {
      this.controllers.delete(id);
      await this.cleanup(id);
    }
  }

  /** AC-P10.5-4: the raw video and audio go; transcript, frames and result stay. */
  private async cleanup(id: string): Promise<void> {
    if (this.opts.keepSource) return;
    const dir = this.jobDir(id);
    const files = await readdir(dir).catch(() => [] as string[]);
    for (const f of files) if (/^source\.|^subs\.|\.part$|\.ytdl$/.test(f)) await rm(join(dir, f), { force: true });
    await rm(join(dir, "chunks"), { recursive: true, force: true });
    await rm(join(dir, "candidates"), { recursive: true, force: true });
  }

  private async source(dir: string): Promise<string> {
    const f = (await readdir(dir)).find((n) => n.startsWith("source.") && !n.endsWith(".part") && !n.endsWith(".ytdl"));
    if (!f) throw new Error("Quelldatei fehlt (schon gelöscht?) — Job bitte neu starten.");
    return join(dir, f);
  }

  private async readJson<T>(id: string, name: string): Promise<T | null> {
    return readFile(join(this.jobDir(id), name), "utf8")
      .then((t) => JSON.parse(t) as T)
      .catch(() => null);
  }

  private async writeJson(id: string, name: string, value: unknown): Promise<void> {
    await writeFile(join(this.jobDir(id), name), JSON.stringify(value, null, 1), { mode: 0o600 });
  }

  // ---- steps ------------------------------------------------------------

  private async fetchStep(job: MediaJob, signal: AbortSignal): Promise<StepOutcome> {
    const dir = this.jobDir(job.id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    if (job.source.kind === "file") {
      await this.source(dir);
      await this.writeJson(job.id, "meta.json", { title: job.source.name, durationSec: null, url: null, subtitles: null, language: null } satisfies FetchMeta);
      return { detail: `Datei ${job.source.name ?? ""}`.trim(), via: "Upload" };
    }
    const url = job.source.url!;
    const yt = this.opts.ytDlp ?? "yt-dlp";
    this.egress(job.id, "fetch", url, false);
    const info = JSON.parse((await this.run(yt, ["--no-playlist", "--dump-single-json", "--no-warnings", url], { signal, timeoutMs: 120_000 })).stdout) as {
      title?: string;
      duration?: number;
      is_live?: boolean;
      webpage_url?: string;
      language?: string | null;
      subtitles?: Record<string, unknown>;
      automatic_captions?: Record<string, unknown>;
    };
    if (info.is_live) throw new Error("Live-Streams werden nicht analysiert.");
    if (info.duration && info.duration > job.limits.maxDurationSec) throw new Error(`Zu lang (${formatTimestamp(info.duration * 1000)}) — erlaubt sind ${formatTimestamp(job.limits.maxDurationSec * 1000)}.`);
    this.patch(job.id, (j) => ({ ...j, title: info.title ?? j.title, durationSec: info.duration ?? null }));
    // Provider subtitles first (T10.5.3): exact words, no STT needed.
    const lang = job.language !== "auto" ? job.language : (info.language ?? "").slice(0, 2) || null;
    let subtitles: FetchMeta["subtitles"] = null;
    if (lang) {
      const manual = Object.keys(info.subtitles ?? {}).find((k) => k === lang || k.startsWith(`${lang}-`));
      const auto = [`${lang}-orig`, lang].find((k) => k in (info.automatic_captions ?? {}));
      const key = manual ?? auto;
      if (key) {
        try {
          await this.run(yt, ["--no-playlist", "--skip-download", manual ? "--write-subs" : "--write-auto-subs", "--sub-langs", key, "--sub-format", "vtt", "-o", join(dir, "subs.%(ext)s"), url], { signal, timeoutMs: 120_000 });
          const file = (await readdir(dir)).find((f) => f.startsWith("subs.") && f.endsWith(".vtt"));
          if (file) {
            await rename(join(dir, file), join(dir, "subs.vtt"));
            subtitles = manual ? "Untertitel" : "automatische Untertitel";
          }
        } catch (err) {
          this.opts.log?.("subtitles failed", { id: job.id, error: String(err) });
        }
      }
    }
    // YouTube sometimes answers a first download with 403 (stale signed URL);
    // a second attempt re-extracts and usually goes through.
    for (let attempt = 1; ; attempt++) {
      try {
        await this.run(
          yt,
          ["--no-playlist", "--newline", "--no-part", "-f", "bv*[height<=720]+ba/b[height<=720]/bv*+ba/b", "--merge-output-format", "mp4", "--max-filesize", String(job.limits.maxBytes), "-o", join(dir, "source.%(ext)s"), url],
          {
            signal,
            timeoutMs: 30 * 60_000,
            onLine: (line) => {
              const m = /\[download\]\s+([\d.]+)%/.exec(line);
              if (m) this.progress(job.id, "fetch", Number(m[1]) / 100);
            },
          },
        );
        break;
      } catch (err) {
        if (signal.aborted || attempt >= 2 || !/403|Forbidden|timed out|Connection reset/i.test(String(err))) throw err;
        this.opts.log?.("download retry", { id: job.id, error: String(err).slice(0, 200) });
      }
    }
    const src = await this.source(dir).catch(() => {
      throw new Error("Nichts heruntergeladen — zu groß (Limit) oder nicht verfügbar.");
    });
    await this.writeJson(job.id, "meta.json", { title: info.title ?? null, durationSec: info.duration ?? null, url: info.webpage_url ?? url, subtitles, language: lang } satisfies FetchMeta);
    const mb = (await stat(src)).size / 1024 / 1024;
    return { detail: `${info.title ?? "Video"} · ${mb.toFixed(1)} MB${subtitles ? ` · ${subtitles}` : ""}`, via: "yt-dlp" };
  }

  private async probeStep(job: MediaJob, signal: AbortSignal): Promise<StepOutcome> {
    const src = await this.source(this.jobDir(job.id));
    const out = JSON.parse((await this.run("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", src], { signal, timeoutMs: 60_000 })).stdout) as {
      format?: { duration?: string };
      streams?: { codec_type?: string; disposition?: { attached_pic?: number } }[];
    };
    const durationSec = Number(out.format?.duration ?? 0);
    const hasAudio = (out.streams ?? []).some((s) => s.codec_type === "audio");
    const hasVideo = (out.streams ?? []).some((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
    if (!hasAudio && !hasVideo) throw new Error("Weder Ton- noch Bildspur gefunden.");
    if (durationSec > job.limits.maxDurationSec) throw new Error(`Zu lang (${formatTimestamp(durationSec * 1000)}) — erlaubt sind ${formatTimestamp(job.limits.maxDurationSec * 1000)}.`);
    await this.writeJson(job.id, "probe.json", { durationSec, hasAudio, hasVideo } satisfies Probe);
    this.patch(job.id, (j) => ({ ...j, durationSec: Math.round(durationSec) }));
    return { detail: `${formatTimestamp(durationSec * 1000)} · ${[hasVideo && "Bild", hasAudio && "Ton"].filter(Boolean).join(" + ")}`, via: "ffprobe" };
  }

  private async audioStep(job: MediaJob, signal: AbortSignal): Promise<StepOutcome> {
    const dir = this.jobDir(job.id);
    const meta = (await this.readJson<FetchMeta>(job.id, "meta.json"))!;
    const probe = (await this.readJson<Probe>(job.id, "probe.json"))!;
    if (meta.subtitles && existsSync(join(dir, "subs.vtt"))) {
      const segments = parseVtt(await readFile(join(dir, "subs.vtt"), "utf8"));
      if (segments.length) {
        await this.writeJson(job.id, "transcript.json", { segments, via: meta.subtitles, language: meta.language } satisfies StoredTranscript);
        return { detail: `${segments.length} Zeilen aus den ${meta.subtitles} des Anbieters`, via: meta.subtitles };
      }
    }
    if (!probe.hasAudio) {
      await this.writeJson(job.id, "transcript.json", { segments: [], via: null, language: null } satisfies StoredTranscript);
      return { detail: "Keine Tonspur.", skipped: true };
    }
    const src = await this.source(dir);
    const chunks = join(dir, "chunks");
    await rm(chunks, { recursive: true, force: true });
    await mkdir(chunks, { recursive: true });
    const gemini = job.allowCloud ? this.opts.gemini?.() : undefined;
    if (this.opts.stt) {
      await this.run("ffmpeg", ["-loglevel", "error", "-y", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "segment", "-segment_time", String(CHUNK_SEC), join(chunks, "c_%03d.wav")], { signal, timeoutMs: 20 * 60_000 });
      const files = (await readdir(chunks)).filter((f) => f.endsWith(".wav")).sort();
      const segments: TranscriptSegment[] = [];
      let language: string | null = null;
      if (!/^https?:\/\/(127\.|localhost)/.test(this.opts.stt.url)) this.egress(job.id, "audio", this.opts.stt.url, true);
      for (const [i, f] of files.entries()) {
        const out = await whisperSegments(this.opts.stt, await readFile(join(chunks, f)), job.language === "auto" ? (language ?? "auto") : job.language, i * CHUNK_SEC * 1000, signal);
        segments.push(...out.segments);
        language ??= out.language;
        this.progress(job.id, "audio", (i + 1) / files.length, `${segments.length} Sätze · ${i + 1}/${files.length} Abschnitte`);
      }
      await this.writeJson(job.id, "transcript.json", { segments, via: "whisper.cpp (lokal)", language } satisfies StoredTranscript);
      return { detail: `${segments.length} Sätze${language ? ` · Sprache ${language}` : ""}`, via: "whisper.cpp (lokal)" };
    }
    if (gemini) {
      await this.run("ffmpeg", ["-loglevel", "error", "-y", "-i", src, "-vn", "-ac", "1", "-c:a", "libopus", "-b:a", "32k", "-f", "segment", "-segment_time", "1200", join(chunks, "c_%03d.ogg")], { signal, timeoutMs: 20 * 60_000 });
      const files = (await readdir(chunks)).filter((f) => f.endsWith(".ogg")).sort();
      this.egress(job.id, "audio", GEMINI_HOST, false);
      const segments: TranscriptSegment[] = [];
      for (const [i, f] of files.entries()) {
        segments.push(...(await transcribeGemini(gemini, await readFile(join(chunks, f)), i * 1200 * 1000, signal)));
        this.progress(job.id, "audio", (i + 1) / files.length);
      }
      await this.writeJson(job.id, "transcript.json", { segments, via: `Gemini (${gemini.model})`, language: job.language === "auto" ? null : job.language } satisfies StoredTranscript);
      return { detail: `${segments.length} Sätze`, via: `Gemini (${gemini.model})` };
    }
    await this.writeJson(job.id, "transcript.json", { segments: [], via: null, language: null } satisfies StoredTranscript);
    return { detail: "Keine Spracherkennung: stt in hub.config.json eintragen oder Cloud (Gemini) für diesen Job erlauben.", skipped: true };
  }

  private async framesStep(job: MediaJob, signal: AbortSignal): Promise<StepOutcome> {
    const dir = this.jobDir(job.id);
    const probe = (await this.readJson<Probe>(job.id, "probe.json"))!;
    if (!probe.hasVideo) {
      await this.writeJson(job.id, "frames.json", []);
      return { detail: "Keine Bildspur.", skipped: true };
    }
    const src = await this.source(dir);
    const cand = join(dir, "candidates");
    await rm(cand, { recursive: true, force: true });
    await mkdir(cand, { recursive: true });
    // Scene changes (slides score only ~0.1, hence the low threshold, at
    // most one per 2 s), plus a frame at least every `interval` s for videos
    // that barely cut. Near-duplicates go afterwards (dHash).
    const interval = Math.max(15, Math.ceil(probe.durationSec / job.limits.maxFrames));
    const times: number[] = [];
    await this.run(
      "ffmpeg",
      ["-hide_banner", "-y", "-i", src, "-an", "-vf", `select='eq(n\\,0)+gt(scene\\,0.08)*gte(t-prev_selected_t\\,2)+gte(t-prev_selected_t\\,${interval})',scale='min(1280\\,iw)':-2,showinfo`, "-fps_mode", "vfr", "-q:v", "3", join(cand, "c_%04d.jpg")],
      {
        signal,
        timeoutMs: 30 * 60_000,
        onLine: (line) => {
          const m = /Parsed_showinfo.*\bpts_time:\s*([\d.]+)/.exec(line);
          if (m) {
            times.push(Number(m[1]) * 1000);
            if (probe.durationSec > 0) this.progress(job.id, "frames", Number(m[1]) / probe.durationSec);
          }
        },
      },
    );
    const files = (await readdir(cand)).filter((f) => f.endsWith(".jpg")).sort();
    const candidates: { atMs: number; hash: bigint; file: string }[] = [];
    for (const [i, f] of files.entries()) {
      const px = await this.run("ffmpeg", ["-loglevel", "error", "-i", join(cand, f), "-vf", "scale=9:8,format=gray", "-f", "rawvideo", "-"], { signal, timeoutMs: 30_000, binary: true });
      candidates.push({ atMs: Math.round(times[i] ?? 0), hash: dHash(new Uint8Array(px.bytes ?? [])), file: f });
    }
    const kept = pickFrames(candidates, job.limits.maxFrames);
    const framesDir = join(dir, "frames");
    await rm(framesDir, { recursive: true, force: true });
    await mkdir(framesDir, { recursive: true });
    const frames: Pick<KeyFrame, "index" | "atMs" | "file">[] = [];
    for (const [i, c] of kept.entries()) {
      const file = `frame_${String(i + 1).padStart(4, "0")}.jpg`;
      await rename(join(cand, c.file), join(framesDir, file));
      frames.push({ index: i + 1, atMs: c.atMs, file });
    }
    await rm(cand, { recursive: true, force: true });
    await this.writeJson(job.id, "frames.json", frames);
    return { detail: `${frames.length} Schlüsselbilder aus ${files.length} Kandidaten (Szenenwechsel, Duplikate entfernt)`, via: "ffmpeg" };
  }

  private async visionStep(job: MediaJob, signal: AbortSignal): Promise<StepOutcome> {
    const frames = (await this.readJson<Pick<KeyFrame, "index" | "atMs" | "file">[]>(job.id, "frames.json")) ?? [];
    if (frames.length === 0) {
      await this.writeJson(job.id, "vision.json", []);
      return { detail: "Keine Schlüsselbilder.", skipped: true };
    }
    const gemini = job.allowCloud ? this.opts.gemini?.() : undefined;
    const model = this.opts.vision ? { kind: "local" as const, cfg: this.opts.vision } : gemini ? { kind: "gemini" as const, cfg: gemini } : null;
    if (model?.kind === "local") this.egress(job.id, "vision", this.opts.vision!.url, true);
    if (model?.kind === "gemini") this.egress(job.id, "vision", GEMINI_HOST, false);
    const tesseract = await this.run("tesseract", ["--version"], { timeoutMs: 10_000 }).then(() => true, () => false);
    const out: Pick<KeyFrame, "index" | "description" | "ocr" | "via">[] = [];
    let failures = 0;
    for (const [i, f] of frames.entries()) {
      const path = join(this.jobDir(job.id), "frames", f.file);
      let ocr: string | null = null;
      if (tesseract) {
        const args = [path, "stdout", "-l", "deu+eng", ...(this.opts.tessdataDir ? ["--tessdata-dir", this.opts.tessdataDir] : [])];
        ocr = cleanOcr((await this.run("tesseract", args, { signal, timeoutMs: 60_000 }).catch(() => this.run("tesseract", [path, "stdout"], { signal, timeoutMs: 60_000 }).catch(() => ({ stdout: "" })))).stdout);
      }
      let reading: FrameReading = { description: null, text: null };
      if (model) {
        try {
          const jpeg = await readFile(path);
          reading = model.kind === "local" ? await describeFrameOpenAi(model.cfg, jpeg, signal) : await describeFrameGemini(model.cfg, jpeg, signal);
        } catch (err) {
          if (signal.aborted) throw err;
          failures++;
        }
      }
      const via = [ocr ? "tesseract" : null, reading.description ? (model?.kind === "local" ? `${this.opts.vision!.model} (lokal)` : `Gemini (${gemini?.model})`) : null].filter(Boolean).join(" + ") || null;
      out.push({ index: f.index, description: reading.description, ocr: ocr ?? cleanOcr(reading.text), via });
      this.progress(job.id, "vision", (i + 1) / frames.length);
    }
    await this.writeJson(job.id, "vision.json", out);
    const described = out.filter((o) => o.description).length;
    const read = out.filter((o) => o.ocr).length;
    const why = model ? (failures ? ` · ${failures} Beschreibungen fehlgeschlagen` : "") : " · keine Bildbeschreibung (kein lokales Bildmodell; Cloud nicht erlaubt oder kein Gemini-Schlüssel)";
    return { detail: `${read} mit Text, ${described} beschrieben${why}`, via: out.find((o) => o.via)?.via ?? (tesseract ? "tesseract" : null) };
  }

  private async mergeStep(job: MediaJob): Promise<StepOutcome> {
    const meta = (await this.readJson<FetchMeta>(job.id, "meta.json"))!;
    const probe = (await this.readJson<Probe>(job.id, "probe.json"))!;
    const transcript = (await this.readJson<StoredTranscript>(job.id, "transcript.json")) ?? { segments: [], via: null, language: null };
    const frames = (await this.readJson<Pick<KeyFrame, "index" | "atMs" | "file">[]>(job.id, "frames.json")) ?? [];
    const vision = (await this.readJson<Pick<KeyFrame, "index" | "description" | "ocr" | "via">[]>(job.id, "vision.json")) ?? [];
    const notes: string[] = [];
    for (const s of ["audio", "frames", "vision"] as const) {
      const st = this.get(job.id)!.steps[s];
      if ((st.status === "skipped" || st.status === "failed") && st.detail) notes.push(`${s === "audio" ? "Transkript" : s === "frames" ? "Schlüsselbilder" : "Bilder"}: ${st.detail}`);
    }
    const result: MediaResult = {
      jobId: job.id,
      title: meta.title ?? job.source.name ?? "Video",
      url: meta.url,
      durationSec: Math.round(probe.durationSec),
      language: transcript.language ?? meta.language,
      transcriptVia: transcript.via,
      transcript: compactSegments(transcript.segments),
      frames: frames.map((f) => {
        const v = vision.find((x) => x.index === f.index);
        return { ...f, description: v?.description ?? null, ocr: v?.ocr ?? null, via: v?.via ?? null };
      }),
      chapters: [],
      summary: null,
      keyPoints: [],
      summaryVia: null,
      notes,
    };
    await this.writeJson(job.id, "timeline.json", result);
    return { detail: `${result.transcript.length} Abschnitte Text, ${result.frames.length} Bilder`, via: "lokal" };
  }

  private material(r: MediaResult): string {
    const lines = [
      ...r.transcript.map((s) => ({ at: s.startMs, text: `[${formatTimestamp(s.startMs)}] ${s.text}` })),
      ...r.frames.filter((f) => f.ocr || f.description).map((f) => ({ at: f.atMs, text: `[${formatTimestamp(f.atMs)}] (Bild) ${[f.description, f.ocr ? `Text: ${f.ocr.replace(/\s+/g, " ").slice(0, 300)}` : null].filter(Boolean).join(" — ")}` })),
    ];
    return lines
      .sort((a, b) => a.at - b.at)
      .map((l) => l.text)
      .join("\n");
  }

  private async summarizeStep(job: MediaJob, signal: AbortSignal): Promise<StepOutcome> {
    const r = (await this.readJson<MediaResult>(job.id, "timeline.json"))!;
    const material = this.material(r);
    const gemini = job.allowCloud ? this.opts.gemini?.() : undefined;
    const durationMs = r.durationSec * 1000;
    let outcome: StepOutcome;
    if (!material.trim()) {
      r.notes.push("Zusammenfassung: nichts zum Zusammenfassen (weder Sprache noch Text im Bild).");
      outcome = { detail: "Nichts zum Zusammenfassen.", skipped: true };
    } else if (!this.opts.summaryModel && !gemini) {
      r.chapters = timeChapters(r.transcript, durationMs);
      r.notes.push("Zusammenfassung: kein lokales Modell konfiguriert (assistant.model) und Cloud nicht erlaubt — Kapitel nur nach Zeit.");
      outcome = { detail: "Kein Modell — Kapitel nach Zeit.", skipped: true };
    } else {
      const ask = async <T>(prompt: string, schema: object, maxTokens: number): Promise<T> =>
        this.opts.summaryModel ? chatJson<T>(this.opts.summaryModel, SYSTEM, prompt, schema, maxTokens, signal) : geminiJson<T>(gemini!, `${SYSTEM}\n\n${prompt}`, signal);
      const via = this.opts.summaryModel ? `${this.opts.summaryModel.model} (lokal)` : `Gemini (${gemini!.model})`;
      if (this.opts.summaryModel) this.egress(job.id, "summarize", this.opts.summaryModel.url, true);
      else this.egress(job.id, "summarize", GEMINI_HOST, false);
      const head = `Titel: ${r.title}\nDauer: ${formatTimestamp(durationMs)}\n`;
      // Short videos get few chapters: about 1.5 per minute, 2 to 12.
      const maxChapters = Math.max(2, Math.min(12, Math.ceil((durationMs / 60_000) * 1.5)));
      const want = `Erstelle JSON: {"summary": "3–6 Sätze", "keyPoints": ["3–8 Kernaussagen"], "chapters": [{"start": "m:ss (eine Zeitmarke aus dem Material)", "title": "höchstens 8 Wörter", "summary": "1–2 Sätze"}]} mit 2–${maxChapters} Kapiteln in zeitlicher Reihenfolge, je ein Kapitel pro Themenwechsel.`;
      try {
        let answer: { summary?: string; keyPoints?: unknown[]; chapters?: { start?: unknown; title?: unknown; summary?: unknown }[] };
        if (material.length <= SUMMARY_PART_CHARS) {
          answer = await ask(`${head}Material (Zeitmarken [m:ss] ab Videobeginn, „(Bild)“ = Schlüsselbild):\n${material}\n\n${want}`, SUMMARY_SCHEMA, 2500);
        } else {
          // Long videos: chapters per part, then one summary over the parts.
          const parts: string[] = [];
          let cur = "";
          for (const line of material.split("\n")) {
            if (cur.length + line.length > SUMMARY_PART_CHARS && cur) {
              parts.push(cur);
              cur = "";
            }
            cur += `${line}\n`;
          }
          if (cur) parts.push(cur);
          const partials: { summary?: string; chapters?: { start?: unknown; title?: unknown; summary?: unknown }[] }[] = [];
          for (const [i, p] of parts.entries()) {
            partials.push(await ask(`${head}Teil ${i + 1} von ${parts.length}:\n${p}\n\nErstelle JSON: {"summary": "2–4 Sätze zu diesem Teil", "keyPoints": [], "chapters": [1–4 Kapitel wie {"start": "m:ss", "title": "...", "summary": "..."}]}.`, SUMMARY_SCHEMA, 1500));
            this.progress(job.id, "summarize", (i + 1) / (parts.length + 1));
          }
          const overall = await ask<{ summary?: string; keyPoints?: unknown[] }>(`${head}Zusammenfassungen der Teile:\n${partials.map((p, i) => `Teil ${i + 1}: ${p.summary ?? ""}`).join("\n")}\n\nErstelle JSON: {"summary": "3–6 Sätze zum ganzen Video", "keyPoints": ["3–8 Kernaussagen"], "chapters": []}.`, SUMMARY_SCHEMA, 1500);
          answer = { ...overall, chapters: partials.flatMap((p) => p.chapters ?? []) };
        }
        r.summary = typeof answer.summary === "string" && answer.summary.trim() ? answer.summary.trim() : null;
        r.keyPoints = (answer.keyPoints ?? []).filter((k): k is string => typeof k === "string" && k.trim().length > 0).slice(0, 8);
        r.chapters = cleanChapters(answer.chapters ?? [], durationMs);
        if (r.chapters.length === 0) r.chapters = timeChapters(r.transcript, durationMs);
        r.summaryVia = via;
        outcome = { detail: `${r.chapters.length} Kapitel, ${r.keyPoints.length} Kernaussagen`, via };
      } catch (err) {
        if (signal.aborted) throw err;
        r.chapters = timeChapters(r.transcript, durationMs);
        const message = err instanceof Error ? err.message : String(err);
        r.notes.push(`Zusammenfassung fehlgeschlagen (${message.slice(0, 120)}) — Kapitel nur nach Zeit.`);
        await this.finish(job, r);
        throw new Error(`${message.slice(0, 200)} — Ergebnis ohne Zusammenfassung gespeichert.`);
      }
    }
    await this.finish(job, r);
    return outcome;
  }

  /** result.json + the Markdown attachment a session gets (AC-P10.5-5). */
  private async finish(job: MediaJob, r: MediaResult): Promise<void> {
    await this.writeJson(job.id, "result.json", r);
    const md = mediaResultMarkdown(r, (file) => join(this.jobDir(job.id), "frames", file));
    await writeFile(join(this.jobDir(job.id), "result.md"), md, { mode: 0o600 });
    const safe = r.title.replace(/\.(mp4|webm|mkv|mov|avi|m4v|m4a|mp3|wav|ogg|opus|flac)$/i, "").replace(/[^\p{L}\p{N} ._-]/gu, "").trim().slice(0, 80) || "video";
    const attachment = await this.opts.attachments.save(new TextEncoder().encode(md), `${safe}.video.md`, "text/markdown");
    this.patch(job.id, (j) => ({ ...j, resultAttachmentId: attachment.id }));
  }
}
