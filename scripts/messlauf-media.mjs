#!/usr/bin/env node
/* global fetch */
// T10.5.7 / EPIC-P10.5: real videos through the media pipeline, with the
// real services — whisper.cpp (evox2), the local model (llama.cpp), real
// yt-dlp/ffmpeg/tesseract. Per video: step times, transcript source,
// frames, chapters; for one video the same file twice (subtitles vs.
// whisper → WER); and a question to the model answered from the result
// Markdown, checked against the transcript (AC-P10.5-5).
//
//   LLAMA_KEY=… node scripts/messlauf-media.mjs [out.json]
//
// Env: STT_URL (default evox2:8094), LLM_URL (default evox2:8081/v1).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AttachmentStore, HubDatabase, MediaJobs } from "../packages/core/src/index.ts";

const out = process.argv[2] ?? join(tmpdir(), "messlauf-media.json");
const STT_URL = process.env.STT_URL ?? "http://100.65.133.28:8094/inference";
const LLM_URL = process.env.LLM_URL ?? "http://100.65.133.28:8081/v1";
const key = process.env.LLAMA_KEY;
if (!key) throw new Error("LLAMA_KEY fehlt");

const VIDEOS = [
  { id: "news-de", kind: "Nachrichten (Sprecherin, Einspieler)", url: "https://www.youtube.com/watch?v=zj6r2E9Pvbo", question: "Bei welcher Zeitmarke geht es zum ersten Mal um OpenAI? Antworte nur mit der Zeitmarke m:ss.", needle: /openai/i },
  { id: "tutorial-en", kind: "Tutorial mit Bildschirmtext (Englisch)", url: "https://www.youtube.com/watch?v=Gjnup-PuquQ", question: "Bei welcher Zeitmarke wird das Dockerfile erklärt? Antworte nur mit der Zeitmarke m:ss.", needle: /docker ?file/i },
  { id: "talk-de", kind: "Gespräch (zwei Personen)", url: "https://www.youtube.com/watch?v=SrCScTY9UW4", question: "Bei welcher Zeitmarke wird Python erwähnt? Antworte nur mit der Zeitmarke m:ss.", needle: /python/i },
];
const TOO_LONG = "https://www.youtube.com/watch?v=gEroPpvQyNc";

const root = mkdtempSync(join(tmpdir(), "ancientvoid-messlauf-media-"));
const db = new HubDatabase(join(root, "hub.db"));
const attachments = new AttachmentStore(db, join(root, "attachments"));
const media = new MediaJobs(db, {
  dir: join(root, "media"),
  attachments,
  stt: { url: STT_URL, timeoutMs: 15 * 60_000 },
  summaryModel: { url: LLM_URL, model: "qwen3-coder", apiKey: key, timeoutMs: 10 * 60_000 },
  log: (m, meta) => console.error(m, meta ?? ""),
});

const secs = (a, b) => (a && b ? (Date.parse(b) - Date.parse(a)) / 1000 : null);
function words(s) {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}
function wer(ref, hyp) {
  const r = words(ref);
  const h = words(hyp);
  let prev = Array.from({ length: h.length + 1 }, (_, j) => j);
  for (let i = 1; i <= r.length; i++) {
    const cur = [i];
    for (let j = 1; j <= h.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
    prev = cur;
  }
  return r.length ? prev[h.length] / r.length : 0;
}
const ts = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
const parseTs = (s) => {
  const m = /(\d+):(\d{2})/.exec(s);
  return m ? (Number(m[1]) * 60 + Number(m[2])) * 1000 : null;
};

async function ask(md, question) {
  const res = await fetch(`${LLM_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: "qwen3-coder", temperature: 0, max_tokens: 20, messages: [{ role: "user", content: `${md}\n\n---\n${question}` }] }),
  });
  const body = await res.json();
  return body.choices?.[0]?.message?.content?.trim() ?? "";
}

async function run(label, request) {
  const t0 = Date.now();
  const job = request.file ? await media.createFromFile(request.file, request.name, { allowCloud: false, language: "auto" }) : await media.create(request);
  await media.idle();
  const done = media.get(job.id);
  const result = await media.result(job.id);
  const md = done.resultAttachmentId ? await attachments.text(done.resultAttachmentId) : "";
  const row = {
    label,
    jobId: job.id,
    status: done.status,
    error: done.error,
    title: done.title,
    durationSec: done.durationSec,
    totalSec: (Date.now() - t0) / 1000,
    steps: Object.fromEntries(Object.entries(done.steps).map(([k, v]) => [k, { status: v.status, sec: secs(v.startedAt, v.finishedAt), via: v.via, detail: v.detail }])),
    egress: done.egress.map((e) => `${e.step}:${e.service}${e.own ? " (eigen)" : ""}`),
    transcriptVia: result?.transcriptVia ?? null,
    transcriptLines: result?.transcript.length ?? 0,
    transcriptText: result?.transcript.map((s) => s.text).join(" ") ?? "",
    frames: result?.frames.length ?? 0,
    framesWithText: result?.frames.filter((f) => f.ocr).length ?? 0,
    ocrSamples: result?.frames.filter((f) => f.ocr).slice(0, 3).map((f) => `${ts(f.atMs)} ${f.ocr.replace(/\s+/g, " ").slice(0, 80)}`) ?? [],
    chapters: result?.chapters.map((c) => `${ts(c.startMs)} ${c.title}`) ?? [],
    summary: result?.summary ?? null,
    notes: result?.notes ?? [],
    md,
    sourceLeft: readdirSync(media.jobDir(job.id)).filter((f) => f.startsWith("source.")),
  };
  console.log(`${label}: ${row.status} in ${row.totalSec.toFixed(1)} s (Video ${row.durationSec} s) · ${row.transcriptVia} ${row.transcriptLines} Zeilen · ${row.frames} Bilder (${row.framesWithText} mit Text) · ${row.chapters.length} Kapitel${row.error ? ` · ${row.error}` : ""}`);
  return row;
}

const rows = [];
for (const v of VIDEOS) {
  const viaUrl = await run(`${v.id} (Link)`, { url: v.url, allowCloud: false, language: "auto" });
  // Same video as a file → whisper instead of the provider's captions.
  const dl = join(root, `${v.id}.mp4`);
  execFileSync("yt-dlp", ["--no-playlist", "-q", "--no-warnings", "-f", "bv*[height<=720]+ba/b[height<=720]/b", "--merge-output-format", "mp4", "-o", dl, v.url], { stdio: "ignore", timeout: 600_000 });
  // The upload path (streamed file), as the PWA uses it.
  const viaFile = await run(`${v.id} (Datei, whisper)`, { file: dl, name: `${v.id}.mp4` });
  const reference = viaUrl.transcriptVia?.includes("Untertitel") ? viaUrl.transcriptText : null;
  const w = reference ? wer(reference, viaFile.transcriptText) : null;
  // AC-P10.5-5: the model answers from the result Markdown; checked against the transcript.
  const answer = await ask(viaFile.md, v.question);
  const result = await media.result(viaFile.jobId);
  const truth = result.transcript.find((s) => v.needle.test(s.text));
  const said = parseTs(answer);
  const ok = truth && said !== null ? Math.abs(said - truth.startMs) <= 20_000 : false;
  console.log(`  WER whisper vs. ${viaUrl.transcriptVia}: ${w === null ? "n/a" : (w * 100).toFixed(1) + " %"} · Frage: „${answer}“ · Transkript: ${truth ? ts(truth.startMs) : "—"} → ${ok ? "richtig" : "falsch"}`);
  rows.push({ video: v, viaUrl: { ...viaUrl, md: undefined, transcriptText: undefined }, viaFile: { ...viaFile, md: undefined, transcriptText: undefined }, werVsCaptions: w, question: v.question, answer, truth: truth ? ts(truth.startMs) : null, answerOk: ok });
}
const limit = await run("zu lang", { url: TOO_LONG, allowCloud: false, language: "auto" });
rows.push({ limit: { status: limit.status, error: limit.error, totalSec: limit.totalSec } });
writeFileSync(out, JSON.stringify(rows, null, 1));
console.log(`→ ${out}`);
db.close();
