import type { FastifyInstance } from "fastify";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * T10.2 (ADR-0028): local speech-to-text. The phone records (push to talk),
 * the hub converts to 16 kHz mono WAV and asks a whisper.cpp-compatible
 * server on our own hardware — no audio leaves the tailnet. The text comes
 * back editable; nothing is sent or executed from here.
 */
export interface SttConfig {
  /** whisper-server `/inference` URL (e.g. http://100.65.133.28:8094/inference). */
  url: string;
  engine: string;
  language: string;
  /** Words to spell right (project terms) — a Whisper prompt. */
  vocabulary: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

async function toWav(audio: Buffer, mime: string): Promise<Buffer> {
  if (mime.includes("wav") && audio.subarray(0, 4).toString() === "RIFF") return audio;
  const dir = await mkdtemp(join(tmpdir(), "uacc-stt-"));
  try {
    const src = join(dir, "in");
    const out = join(dir, "out.wav");
    await writeFile(src, audio);
    await run("ffmpeg", ["-loglevel", "error", "-y", "-i", src, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", out], { timeout: 30_000 });
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Project names as spoken ("mobile hub") and written ("mobile-hub"). */
export function projectVocabulary(paths: readonly string[]): string {
  const names = [...new Set(paths.map((p) => p.split("/").filter(Boolean).pop() ?? "").filter((n) => n.length > 1))];
  return names.slice(0, 40).join(", ");
}

export function registerSttRoutes(app: FastifyInstance, cfg: SttConfig | undefined, projects: () => Promise<string[]> = async () => []): void {
  app.get("/api/stt", async () => (cfg ? { available: true, engine: cfg.engine, language: cfg.language, local: true } : { available: false }));

  app.register(async (scope) => {
    scope.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: MAX_AUDIO_BYTES }, (_req, body, done) => done(null, body));
    scope.post("/api/stt", { bodyLimit: MAX_AUDIO_BYTES }, async (req, reply) => {
      if (!cfg) return reply.code(501).send({ error: "Keine lokale Spracherkennung konfiguriert (stt in hub.config.json)." });
      const body = req.body as Buffer | undefined;
      if (!body || !Buffer.isBuffer(body) || body.length < 100) return reply.code(400).send({ error: "Keine Aufnahme." });
      const started = Date.now();
      let wav: Buffer;
      try {
        wav = await toWav(body, String(req.headers["content-type"] ?? ""));
      } catch (err) {
        return reply.code(422).send({ error: `Aufnahme nicht lesbar (${err instanceof Error ? err.message.slice(0, 80) : "ffmpeg"})` });
      }
      const converted = Date.now();
      const boundary = `----uacc${started}`;
      const field = (name: string, value: string) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
      // T10.2: the configured words plus this hub's project names.
      const vocabulary = [cfg.vocabulary, projectVocabulary(await projects().catch(() => []))].filter(Boolean).join(" ");
      const multipart = Buffer.concat([
        Buffer.from(field("response_format", "json") + field("language", cfg.language) + (vocabulary ? field("prompt", vocabulary) : "") + `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.wav"\r\nContent-Type: audio/wav\r\n\r\n`),
        wav,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      try {
        const res = await (cfg.fetch ?? fetch)(cfg.url, { method: "POST", body: multipart, headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, signal: AbortSignal.timeout(cfg.timeoutMs) });
        if (!res.ok) throw new Error(`STT ${res.status}`);
        const out = (await res.json()) as { text?: string };
        const text = (out.text ?? "").replace(/\s+/g, " ").trim();
        // 16 kHz mono 16 bit: bytes after the 44-byte header / 32000 = seconds.
        const audioMs = Math.max(0, Math.round(((wav.length - 44) / 32_000) * 1000));
        return { text, engine: cfg.engine, audioMs, convertMs: converted - started, latencyMs: Date.now() - started };
      } catch (err) {
        return reply.code(502).send({ error: `Spracherkennung nicht erreichbar (${err instanceof Error ? err.message.slice(0, 80) : "Fehler"}) — bitte tippen.` });
      }
    });
  });
}
