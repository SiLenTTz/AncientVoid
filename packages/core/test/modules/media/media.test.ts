import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyFile, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { formatTimestamp, mediaResultMarkdown, parseTimestamp, timestampLink, type MediaResult } from "@ancientvoid/contracts";
import { AttachmentStore, HubDatabase, MediaJobs, runTool, type MediaJobsOptions, type ToolRunner } from "../../../src/index.ts";
import { checkMediaUrl } from "../../../src/modules/media/tools.ts";
import { cleanOcr } from "../../../src/modules/media/jobs.ts";
import { cleanChapters, compactSegments, dHash, hamming, parseVtt, pickFrames, timeChapters } from "../../../src/modules/media/timeline.ts";

const FIXTURE = join(import.meta.dirname, "../../fixtures/media/slides.mp4");
// ADR-0002-Muster: die Job-Tests fahren echte ffmpeg/ffprobe/tesseract — fehlen sie, sichtbarer Skip.
const has = (cmd: string) => spawnSync("sh", ["-c", `command -v ${cmd}`]).status === 0;
const hasMediaTools = has("ffmpeg") && has("ffprobe") && has("tesseract");

describe("media timeline helpers (T10.5.3/T10.5.5)", () => {
  it("VTT: YouTube's rolling captions give every line once, at its first time", () => {
    const vtt = [
      "WEBVTT",
      "Kind: captions",
      "",
      "00:00:00.000 --> 00:00:02.500 align:start position:0%",
      "Hallo<00:00:00.500><c> und</c><00:00:01.000><c> willkommen</c>",
      "",
      "00:00:02.500 --> 00:00:02.510",
      "Hallo und willkommen",
      "",
      "00:00:02.510 --> 00:00:05.000",
      "Hallo und willkommen",
      "heute &amp; morgen geht es um Tests",
      "",
      "01:02:03.004 --> 01:02:04.000",
      "Ende",
    ].join("\n");
    expect(parseVtt(vtt)).toEqual([
      { startMs: 0, endMs: 2500, text: "Hallo und willkommen" },
      { startMs: 2510, endMs: 5000, text: "heute & morgen geht es um Tests" },
      { startMs: 3_723_004, endMs: 3_724_000, text: "Ende" },
    ]);
  });

  it("segments merge into blocks up to a sentence end or the time limit", () => {
    const segs = [
      { startMs: 0, endMs: 2000, text: "Erstens installieren wir" },
      { startMs: 2000, endMs: 4000, text: "das Paket." },
      { startMs: 4000, endMs: 30_000, text: "Dann ein langer Teil" },
      { startMs: 30_000, endMs: 31_000, text: "und mehr" },
    ];
    expect(compactSegments(segs, 15_000)).toEqual([
      { startMs: 0, endMs: 4000, text: "Erstens installieren wir das Paket." },
      { startMs: 4000, endMs: 30_000, text: "Dann ein langer Teil" },
      { startMs: 30_000, endMs: 31_000, text: "und mehr" },
    ]);
  });

  it("near-duplicate frames go, many frames are thinned evenly", () => {
    const a = dHash(new Uint8Array(72).map((_, i) => (i % 9) * 20));
    const b = dHash(new Uint8Array(72).map((_, i) => 200 - (i % 9) * 20));
    expect(hamming(a, a)).toBe(0);
    expect(hamming(a, b)).toBeGreaterThan(30);
    const frames = [
      { atMs: 0, hash: a },
      { atMs: 1000, hash: a ^ 1n },
      { atMs: 2000, hash: b },
    ];
    expect(pickFrames(frames, 10).map((f) => f.atMs)).toEqual([0, 2000]);
    const many = Array.from({ length: 10 }, (_, i) => ({ atMs: i * 1000, hash: BigInt(i) << BigInt(i * 6) }));
    expect(pickFrames(many, 5, -1).map((f) => f.atMs)).toEqual([0, 2000, 4000, 6000, 8000]);
  });

  it("model chapters are checked; without a model, chapters follow time", () => {
    expect(
      cleanChapters(
        [
          { start: "0:00", title: "Start", summary: "a" },
          { start: "0:00", title: "Doppelt", summary: "b" },
          { start: "9:99:99", title: "Zu spät", summary: "c" },
          { start: 30, title: "Sekunden", summary: "d" },
          { start: "x", title: "Kaputt" },
          { start: "0:40", title: "" },
        ],
        60_000,
      ),
    ).toEqual([
      { startMs: 0, title: "Start", summary: "a" },
      { startMs: 30_000, title: "Sekunden", summary: "d" },
    ]);
    const segs = Array.from({ length: 12 }, (_, i) => ({ startMs: i * 60_000, endMs: i * 60_000 + 5000, text: `Satz ${i} mit einigen Worten mehr als acht hier drin` }));
    const ch = timeChapters(segs, 12 * 60_000);
    expect(ch.map((c) => c.startMs)).toEqual([0, 240_000, 480_000]);
    expect(ch[0]!.summary).toMatch(/…$/);
  });

  it("OCR noise from camera frames is dropped, slide text stays (messlauf 2026-09-24)", () => {
    expect(cleanOcr("p ! .' | 3 . L b ! Bl {58 3 e 1 5 ¢ 4 Y 4 4R ST BN { 4 } | L ‘3 [ Sy { L @ ‘ | -")).toBeNull();
    expect(cleanOcr("e Pon iavaseren & Jove O b AR e i RS b REY B304 29")).toBeNull();
    expect(cleanOcr("VIRTUAL MACHINE HOST MACHINE 4. Operating System\n| ¢ ; ~")).toBe("VIRTUAL MACHINE HOST MACHINE 4. Operating System");
    expect(cleanOcr("tagesschau24-Update & Kivon OpenAl steuert eigenstandig Hackerangriff")).toMatch(/Hackerangriff/);
    expect(cleanOcr("Kapitel 2 Tests mit npm")).toBe("Kapitel 2 Tests mit npm");
  });

  it("timestamps and links", () => {
    expect(formatTimestamp(83_000)).toBe("1:23");
    expect(formatTimestamp(3_723_000)).toBe("1:02:03");
    expect(parseTimestamp("1:02:03")).toBe(3_723_000);
    expect(parseTimestamp("0:45")).toBe(45_000);
    expect(parseTimestamp("abc")).toBeNull();
    expect(timestampLink("https://www.youtube.com/watch?v=abc", 83_500)).toBe("https://www.youtube.com/watch?v=abc&t=83s");
    expect(timestampLink("https://youtu.be/abc", 5000)).toBe("https://youtu.be/abc?t=5s");
    expect(timestampLink("https://example.com/a.mp4", 5000)).toBeNull();
    expect(timestampLink(null, 5000)).toBeNull();
  });

  it("links into the own network, with credentials or other schemes are refused", () => {
    expect(checkMediaUrl("https://www.youtube.com/watch?v=x")).toBeNull();
    for (const bad of ["file:///etc/passwd", "http://localhost:7373/api", "http://127.0.0.1/", "http://10.0.0.5/a.mp4", "http://192.168.1.2/", "http://100.64.0.10:8094/", "http://[::1]/", "https://user:pw@example.com/v", "http://gpubox.tailnet-example.ts.net/", "nope"]) {
      expect(checkMediaUrl(bad), bad).not.toBeNull();
    }
  });

  it("the Markdown for a session carries timestamps, frame paths and marks descriptions as fallible", () => {
    const r: MediaResult = {
      jobId: "m_1",
      title: "Demo",
      url: "https://youtu.be/x",
      durationSec: 75,
      language: "de",
      transcriptVia: "whisper.cpp (lokal)",
      transcript: [{ startMs: 61_000, endMs: 65_000, text: "Jetzt kommen die Tests." }],
      frames: [{ index: 1, atMs: 0, file: "frame_0001.jpg", description: "Eine Folie.", ocr: "Kapitel 1", via: "tesseract + vl" }],
      chapters: [{ startMs: 60_000, title: "Tests", summary: "Wie man testet." }],
      summary: "Kurz.",
      keyPoints: ["Punkt"],
      summaryVia: "qwen (lokal)",
      notes: ["Hinweis"],
    };
    const md = mediaResultMarkdown(r, (f) => `/data/media/m_1/frames/${f}`);
    expect(md).toContain("[1:01] Jetzt kommen die Tests.");
    expect(md).toContain("- [1:00] **Tests** — Wie man testet.");
    expect(md).toContain("Bild: /data/media/m_1/frames/frame_0001.jpg");
    expect(md).toContain("kann irren");
    expect(md).toContain("Text im Bild: Kapitel 1");
  });
});

/** whisper-server stand-in: verbose_json with segments for the fixture's three sentences. */
function whisperFake(calls: string[], opts: { block?: boolean } = {}): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    calls.push(Buffer.from(init?.body as Buffer).toString("latin1").match(/name="language"\r\n\r\n(\w+)/)?.[1] ?? "?");
    if (opts.block) {
      if (init?.signal?.aborted) throw new Error("abgebrochen");
      await new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("abgebrochen")), { once: true }));
    }
    return new Response(
      JSON.stringify({
        detected_language: "de",
        segments: [
          { start: 0.1, end: 3, text: " Starte eine neue Session mit Codex." },
          { start: 6.1, end: 9.8, text: " Führe bitte die Tests mit npm test aus." },
          { start: 12.1, end: 15.5, text: " Der Worktree liegt unter data worktrees." },
          { start: 16, end: 16.5, text: " [Musik]" },
        ],
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
}

function modelFake(calls: string[]): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
    calls.push(body.messages[1]!.content);
    const content = JSON.stringify({
      summary: "Ein Video über Sessions, Tests und Worktrees.",
      keyPoints: ["Session mit Codex starten", "Tests mit npm test", "Worktree prüfen"],
      chapters: [
        { start: "0:00", title: "Installation", summary: "Eine Session wird gestartet." },
        { start: "0:06", title: "Tests", summary: "npm test läuft." },
        { start: "0:12", title: "Worktree", summary: "Der Worktree wird geprüft." },
      ],
    });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("media jobs (EPIC-P10.5)", () => {
  let dir: string;
  let db: HubDatabase;
  let attachments: AttachmentStore;
  let whisperCalls: string[];
  let modelCalls: string[];
  let toolCalls: string[];

  /** Real ffmpeg/ffprobe/tesseract; yt-dlp is played by a stand-in. */
  function runner(ytdlp: { duration?: number; subtitles?: string; live?: boolean; forbidden?: number } = {}): ToolRunner {
    return async (cmd, args, o) => {
      toolCalls.push(`${cmd} ${args.includes("--dump-single-json") ? "meta" : args.includes("--skip-download") ? "subs" : args[0] === "-v" ? "probe" : ""}`.trim());
      if (cmd !== "yt-dlp") return runTool(cmd, args, o);
      const out = args[args.indexOf("-o") + 1] ?? "";
      if (args.includes("--dump-single-json")) {
        return {
          stdout: JSON.stringify({ title: "Demo-Folien", duration: ytdlp.duration ?? 18, is_live: ytdlp.live ?? false, webpage_url: "https://www.youtube.com/watch?v=demo", language: "de", automatic_captions: ytdlp.subtitles ? { "de-orig": [{}] } : {}, subtitles: {} }),
          stderr: "",
        };
      }
      if (args.includes("--skip-download")) {
        await writeFile(out.replace("%(ext)s", "de-orig.vtt"), ytdlp.subtitles ?? "");
        return { stdout: "", stderr: "" };
      }
      if ((ytdlp.forbidden ?? 0) > 0) {
        ytdlp.forbidden!--;
        throw new Error("yt-dlp Exit 1: ERROR: unable to download video data: HTTP Error 403: Forbidden");
      }
      o?.onLine?.("[download]  50.0% of 70KiB");
      await copyFile(FIXTURE, out.replace("%(ext)s", "mp4"));
      o?.onLine?.("[download] 100.0% of 70KiB");
      return { stdout: "", stderr: "" };
    };
  }

  function service(extra: Partial<MediaJobsOptions> = {}): MediaJobs {
    return new MediaJobs(db, {
      dir: join(dir, "media"),
      attachments,
      stt: { url: "http://100.64.0.10:8094/inference", fetch: whisperFake(whisperCalls) },
      summaryModel: { url: "http://100.64.0.10:8081/v1", model: "qwen3-coder", fetch: modelFake(modelCalls) },
      run: runner(),
      ...extra,
    });
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-media-"));
    db = new HubDatabase(":memory:");
    attachments = new AttachmentStore(db, join(dir, "attachments"));
    whisperCalls = [];
    modelCalls = [];
    toolCalls = [];
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it.skipIf(!hasMediaTools)("a local file: transcript with timestamps, one key frame per slide with its text, chapters, summary — all local (AC-P10.5-1/2)", async () => {
    const upload = await attachments.save(new Uint8Array(await readFile(FIXTURE)), "slides.mp4", "video/mp4");
    const media = service();
    const job = await media.create({ attachmentId: upload.id, allowCloud: false, language: "auto" });
    await media.idle();
    const done = media.get(job.id)!;
    expect(done.status, JSON.stringify(done.steps)).toBe("done");
    expect(done.durationSec).toBe(18);
    expect(Object.values(done.steps).map((s) => s.status)).toEqual(["done", "done", "done", "done", "done", "done", "done"]);

    const r = (await media.result(job.id))!;
    expect(r.transcript.map((s) => formatTimestamp(s.startMs))).toEqual(["0:00", "0:06", "0:12"]);
    expect(r.transcript.some((s) => s.text.includes("[Musik]"))).toBe(false);
    expect(r.language).toBe("de");
    // Three slides → three frames (scene changes; the 10 fps copies deduplicated).
    expect(r.frames.map((f) => Math.round(f.atMs / 1000))).toEqual([0, 6, 12]);
    expect(r.frames[1]!.ocr).toMatch(/Kapitel 2/);
    expect(r.frames[2]!.ocr).toMatch(/Worktree/);
    expect(r.frames.every((f) => f.description === null)).toBe(true);
    expect(r.chapters.map((c) => [formatTimestamp(c.startMs), c.title])).toEqual([["0:00", "Installation"], ["0:06", "Tests"], ["0:12", "Worktree"]]);
    expect(r.summaryVia).toBe("qwen3-coder (lokal)");
    // The model saw the transcript and the text in the images, with timestamps.
    expect(modelCalls[0]).toContain("[0:06] Führe bitte die Tests mit npm test aus.");
    expect(modelCalls[0]).toMatch(/\[0:06\] \(Bild\) Text: Kapitel 2/);

    // Egress: only own hardware (STT, model) — no third party (AC-P10.5-2).
    expect(done.egress.map((e) => [e.step, e.service, e.own])).toEqual([
      ["audio", "100.64.0.10:8094", true],
      ["summarize", "100.64.0.10:8081", true],
    ]);
    // Raw video gone, results stay (AC-P10.5-4); the session attachment exists (AC-P10.5-5).
    const files = await readdir(media.jobDir(job.id));
    expect(files.some((f) => f.startsWith("source."))).toBe(false);
    expect(files).toEqual(expect.arrayContaining(["result.json", "result.md", "transcript.json", "frames"]));
    expect(existsSync(media.framePath(job.id, "frame_0002.jpg")!)).toBe(true);
    const md = await attachments.text(done.resultAttachmentId!);
    expect(md).toContain("[0:06] **Tests**");
    expect(md).toContain(media.framePath(job.id, "frame_0001.jpg"));
    // K5: the job record stays small — no transcript inside.
    expect(JSON.stringify(done).length).toBeLessThan(4096);
  }, 60_000);

  it.skipIf(!hasMediaTools)("a YouTube link with subtitles: the provider's words, no STT; the source host is logged as egress", async () => {
    const vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nStarte eine neue Session\n\n00:00:06.000 --> 00:00:09.000\nTests mit npm\n";
    const media = service({ run: runner({ subtitles: vtt }) });
    const job = await media.create({ url: "https://www.youtube.com/watch?v=demo", allowCloud: false, language: "auto" });
    await media.idle();
    const done = media.get(job.id)!;
    expect(done.status).toBe("done");
    expect(done.title).toBe("Demo-Folien");
    expect(done.steps.audio.via).toBe("automatische Untertitel");
    expect(whisperCalls).toHaveLength(0);
    const r = (await media.result(job.id))!;
    expect(r.url).toBe("https://www.youtube.com/watch?v=demo");
    expect(r.transcript[1]).toMatchObject({ startMs: 6000, text: "Tests mit npm" });
    expect(done.egress.filter((e) => !e.own).map((e) => [e.step, e.service])).toEqual([["fetch", "www.youtube.com"]]);
    expect((await readdir(media.jobDir(job.id))).some((f) => f.startsWith("subs.") || f.startsWith("source."))).toBe(false);
  }, 60_000);

  it.skipIf(!hasMediaTools)("a 403 on the first download is retried once; a second one fails the job in words", async () => {
    const once = service({ run: runner({ forbidden: 1 }) });
    const a = await once.create({ url: "https://www.youtube.com/watch?v=demo", allowCloud: false, language: "auto" });
    await once.idle();
    expect(once.get(a.id)!.status).toBe("done");
    const twice = service({ run: runner({ forbidden: 2 }) });
    const b = await twice.create({ url: "https://www.youtube.com/watch?v=demo", allowCloud: false, language: "auto" });
    await twice.idle();
    expect(twice.get(b.id)).toMatchObject({ status: "failed", error: expect.stringMatching(/403/) });
  }, 60_000);

  it("limits hold before the download: too long or live fails at once, in words", async () => {
    const media = service({ run: runner({ duration: 3 * 3600 }) });
    const job = await media.create({ url: "https://www.youtube.com/watch?v=long", allowCloud: false, language: "auto" });
    await media.idle();
    expect(media.get(job.id)).toMatchObject({ status: "failed", error: expect.stringMatching(/Zu lang \(3:00:00\)/) });
    expect(toolCalls.filter((c) => c === "yt-dlp")).toHaveLength(0); // never downloaded
    await expect(media.create({ url: "http://192.168.1.10/v.mp4", allowCloud: false, language: "auto" })).rejects.toThrow(/Lokale Adressen/);
    const png = await attachments.save(new Uint8Array([1, 2, 3]), "bild.png", "image/png");
    await expect(media.create({ attachmentId: png.id, allowCloud: false, language: "auto" })).rejects.toThrow(/kein Video/);
  });

  it.skipIf(!hasMediaTools)("a hub restart mid-job continues at the unfinished step — finished steps are not repeated (AC-P10.5-3)", async () => {
    const upload = await attachments.save(new Uint8Array(await readFile(FIXTURE)), "slides.mp4", "video/mp4");
    // First hub: speech recognition hangs (then the process "dies").
    const first = service({ stt: { url: "http://100.64.0.10:8094/inference", fetch: whisperFake(whisperCalls, { block: true }) } });
    const job = await first.create({ attachmentId: upload.id, allowCloud: false, language: "de" });
    for (let i = 0; i < 100 && first.get(job.id)!.steps.audio.status !== "running"; i++) await new Promise((r) => setTimeout(r, 50));
    expect(first.get(job.id)!.steps).toMatchObject({ fetch: { status: "done" }, probe: { status: "done" }, audio: { status: "running" } });
    toolCalls = [];
    // Second hub on the same database and directory.
    const second = service();
    expect(second.resume()).toBe(1);
    await second.idle();
    const done = second.get(job.id)!;
    expect(done.status).toBe("done");
    expect(toolCalls).not.toContain("ffprobe probe"); // probe not repeated
    expect(done.steps.audio.detail).toMatch(/Sätze/);
    expect(whisperCalls.at(-1)).toBe("de");
  }, 60_000);

  it.skipIf(!hasMediaTools)("cancel ends a running job visibly and removes the raw video", async () => {
    const upload = await attachments.save(new Uint8Array(await readFile(FIXTURE)), "slides.mp4", "video/mp4");
    const media = service({ stt: { url: "http://stt/inference", fetch: whisperFake(whisperCalls, { block: true }) } });
    const job = await media.create({ attachmentId: upload.id, allowCloud: false, language: "auto" });
    for (let i = 0; i < 100 && media.get(job.id)!.steps.audio.status !== "running"; i++) await new Promise((r) => setTimeout(r, 50));
    media.cancel(job.id);
    await media.idle();
    expect(media.get(job.id)).toMatchObject({ status: "cancelled", steps: { audio: { status: "failed", detail: "abgebrochen" } } });
    expect((await readdir(media.jobDir(job.id))).some((f) => f.startsWith("source."))).toBe(false);
    expect(await media.remove(job.id)).toBe(true);
    expect(media.get(job.id)).toBeUndefined();
  }, 60_000);

  it.skipIf(!hasMediaTools)("Gemini only when the job allows the cloud: then it hears, sees and summarises — and is logged (AC-P10.5-2)", async () => {
    const upload = await attachments.save(new Uint8Array(await readFile(FIXTURE)), "slides.mp4", "video/mp4");
    const geminiCalls: string[] = [];
    const geminiFetch = (async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { contents: { parts: { text?: string; inline_data?: { mime_type: string } }[] }[] };
      const kind = body.contents[0]!.parts[1]?.inline_data?.mime_type ?? "text";
      geminiCalls.push(kind);
      const text =
        kind === "audio/ogg"
          ? JSON.stringify({ segments: [{ start: "0:00", text: "Starte eine Session." }, { start: "0:06", text: "Tests mit npm." }] })
          : kind === "image/jpeg"
            ? JSON.stringify({ description: "Eine farbige Folie mit weißer Schrift.", text: "Kapitel" })
            : JSON.stringify({ summary: "Zusammenfassung von Gemini.", keyPoints: ["A"], chapters: [{ start: "0:00", title: "Alles", summary: "x" }] });
      expect(String(url)).toContain("generativelanguage.googleapis.com");
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const gemini = () => ({ apiKey: "k".repeat(20), model: "gemini-flash-latest", fetch: geminiFetch });

    // Key set, cloud not allowed, no local STT/model: nothing goes to Gemini.
    const local = service({ gemini, stt: undefined, summaryModel: undefined });
    const a = await local.create({ attachmentId: upload.id, allowCloud: false, language: "auto" });
    await local.idle();
    expect(geminiCalls).toHaveLength(0);
    expect(local.get(a.id)).toMatchObject({ status: "done", egress: [], steps: { audio: { status: "skipped" }, summarize: { status: "skipped" } } });
    expect((await local.result(a.id))!.notes.join(" ")).toMatch(/Keine Spracherkennung/);

    // Cloud allowed: transcript, frame descriptions and summary from Gemini, logged per step.
    const b = await local.create({ attachmentId: upload.id, allowCloud: true, language: "auto" });
    await local.idle();
    const done = local.get(b.id)!;
    expect(done.status).toBe("done");
    expect(geminiCalls).toEqual(expect.arrayContaining(["audio/ogg", "image/jpeg", "text"]));
    expect(done.egress.map((e) => [e.step, e.own])).toEqual([
      ["audio", false],
      ["vision", false],
      ["summarize", false],
    ]);
    const r = (await local.result(b.id))!;
    expect(r.transcriptVia).toBe("Gemini (gemini-flash-latest)");
    expect(r.frames[0]!.description).toMatch(/Folie/);
    expect(r.summary).toBe("Zusammenfassung von Gemini.");
  }, 90_000);

  it.skipIf(!hasMediaTools)("the summary model failing keeps the result, with chapters by time and the reason", async () => {
    const upload = await attachments.save(new Uint8Array(await readFile(FIXTURE)), "slides.mp4", "video/mp4");
    const down = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    const media = service({ summaryModel: { url: "http://llm/v1", model: "qwen", fetch: down } });
    const job = await media.create({ attachmentId: upload.id, allowCloud: false, language: "auto" });
    await media.idle();
    const done = media.get(job.id)!;
    expect(done.status).toBe("done");
    expect(done.steps.summarize).toMatchObject({ status: "failed", detail: expect.stringMatching(/Modell 503/) });
    const r = (await media.result(job.id))!;
    expect(r.summary).toBeNull();
    expect(r.chapters.length).toBeGreaterThan(0);
    expect(r.notes.join(" ")).toMatch(/Zusammenfassung fehlgeschlagen/);
    expect(done.resultAttachmentId).not.toBeNull();
  }, 60_000);
});
