import type { FastifyInstance } from "fastify";
import { createWriteStream } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { MediaJobFields, MediaJobRequest } from "@uacc/contracts";
import { runTool, type MediaJobs, type SettingsStore } from "@uacc/core";

/**
 * EPIC-P10.5 (ADR-0030): video analysis. A link (yt-dlp) or an upload
 * (streamed to disk, up to the job limit) becomes a job; the PWA polls its
 * steps. Frames are served by name only; the raw video is never served.
 */
export interface MediaRouteDeps {
  media: MediaJobs;
  settings?: SettingsStore | undefined;
  capabilities: { stt: boolean; summary: boolean; vision: boolean };
  ytDlp?: string;
}

async function available(cmd: string, args: string[]): Promise<boolean> {
  return runTool(cmd, args, { timeoutMs: 10_000 }).then(
    () => true,
    () => false,
  );
}

export function registerMediaRoutes(app: FastifyInstance, deps: MediaRouteDeps): void {
  let tools: Promise<{ ytDlp: boolean; ffmpeg: boolean }> | null = null;
  const idOf = (params: unknown) => {
    const id = (params as { id?: string }).id ?? "";
    return /^m_[a-f0-9]{12}$/.test(id) ? id : null;
  };

  app.get("/api/media", async () => {
    tools ??= Promise.all([available(deps.ytDlp ?? "yt-dlp", ["--version"]), available("ffmpeg", ["-version"])]).then(([ytDlp, ffmpeg]) => ({ ytDlp, ffmpeg }));
    const t = await tools;
    return { available: t.ffmpeg, tools: t, ...deps.capabilities, gemini: Boolean(deps.settings?.gemini()), limits: { maxBytes: deps.media.maxBytes } };
  });

  app.get("/api/media/jobs", async () => deps.media.list());

  app.post("/api/media/jobs", async (req, reply) => {
    const body = MediaJobRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "ungültige Anfrage" });
    try {
      return reply.code(201).send(await deps.media.create(body.data));
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "Job nicht angelegt" });
    }
  });

  app.register(async (scope) => {
    // The body stays a stream: videos can be far larger than memory should hold.
    scope.addContentTypeParser("*", (_req, payload, done) => done(null, payload));
    scope.post("/api/media/upload", async (req, reply) => {
      const q = req.query as { allowCloud?: string; language?: string };
      const opts = MediaJobFields.pick({ allowCloud: true, language: true }).safeParse({ allowCloud: q.allowCloud === "1" || q.allowCloud === "true", language: q.language ?? "auto" });
      if (!opts.success) return reply.code(400).send({ error: "ungültige Sprache" });
      const raw = req.headers["x-filename"];
      let name: string;
      try {
        name = decodeURIComponent(typeof raw === "string" ? raw : "video").split(/[\\/]/).pop() || "video";
      } catch {
        name = "video";
      }
      const limit = deps.media.maxBytes;
      const tooBig = `Datei zu groß (erlaubt ${Math.round(limit / 1024 / 1024)} MB).`;
      if (Number(req.headers["content-length"] ?? 0) > limit) return reply.code(413).send({ error: tooBig });
      const target = await deps.media.uploadTarget();
      let bytes = 0;
      // Past the limit the rest is read and dropped: destroying the request
      // stream would take the response with it.
      const count = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          bytes += chunk.length;
          cb(null, bytes > limit ? undefined : chunk);
        },
      });
      try {
        await pipeline(req.body as Readable, count, createWriteStream(target, { mode: 0o600 }));
        if (bytes > limit) throw new Error(tooBig);
        if (bytes === 0) throw new Error("Leere Datei.");
        return reply.code(201).send(await deps.media.createFromFile(target, name, opts.data));
      } catch (err) {
        await rm(target, { force: true });
        return reply.code(bytes > limit ? 413 : 400).send({ error: err instanceof Error ? err.message : "Upload fehlgeschlagen" });
      }
    });
  });

  app.get("/api/media/jobs/:id", async (req, reply) => {
    const id = idOf(req.params);
    const job = id ? deps.media.get(id) : undefined;
    return job ?? reply.code(404).send({ error: "unbekannter Job" });
  });

  app.get("/api/media/jobs/:id/result", async (req, reply) => {
    const id = idOf(req.params);
    const job = id ? deps.media.get(id) : undefined;
    if (!job) return reply.code(404).send({ error: "unbekannter Job" });
    const result = await deps.media.result(job.id);
    return result ?? reply.code(409).send({ error: job.status === "failed" ? (job.error ?? "fehlgeschlagen") : "noch nicht fertig" });
  });

  app.get("/api/media/jobs/:id/frames/:file", async (req, reply) => {
    const id = idOf(req.params);
    const path = id ? deps.media.framePath(id, (req.params as { file: string }).file) : null;
    if (!path) return reply.code(404).send({ error: "unbekanntes Bild" });
    const bytes = await readFile(path).catch(() => null);
    if (!bytes) return reply.code(404).send({ error: "unbekanntes Bild" });
    return reply.type("image/jpeg").header("cache-control", "private, max-age=86400").header("x-content-type-options", "nosniff").send(bytes);
  });

  app.post("/api/media/jobs/:id/cancel", async (req, reply) => {
    const id = idOf(req.params);
    const job = id ? deps.media.cancel(id) : undefined;
    return job ?? reply.code(404).send({ error: "unbekannter Job" });
  });

  app.delete("/api/media/jobs/:id", async (req, reply) => {
    const id = idOf(req.params);
    return id && (await deps.media.remove(id)) ? { ok: true } : reply.code(404).send({ error: "unbekannter Job" });
  });
}
