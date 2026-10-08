import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AttachmentId, MAX_ATTACHMENT_BYTES } from "@uacc/contracts";
import { DEFAULT_GEMINI_MODEL, type AttachmentStore, type SettingsStore } from "@uacc/core";

/**
 * T7.10 (ADR-0022): files into sessions. Upload as raw bytes (the file name
 * in `x-filename`, URI-encoded); the extraction runs in the background and
 * its state is on the record. Gemini's key is write-only: the API says
 * whether one is set, never which.
 */
export function registerAttachmentRoutes(app: FastifyInstance, deps: { attachments: AttachmentStore; settings: SettingsStore }): void {
  app.register(async (scope) => {
    scope.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: MAX_ATTACHMENT_BYTES + 1024 }, (_req, body, done) => done(null, body));
    scope.post("/api/attachments", { bodyLimit: MAX_ATTACHMENT_BYTES + 1024 }, async (req, reply) => {
      const body = req.body as Buffer | undefined;
      if (!body || !Buffer.isBuffer(body) || body.length === 0) return reply.code(400).send({ error: "Leere Datei." });
      const raw = req.headers["x-filename"];
      let name: string;
      try {
        name = decodeURIComponent(typeof raw === "string" ? raw : "datei");
      } catch {
        name = "datei";
      }
      try {
        const record = await deps.attachments.save(new Uint8Array(body), name, String(req.headers["content-type"] ?? "application/octet-stream").split(";")[0]!.trim());
        return reply.code(201).send(record);
      } catch (err) {
        return reply.code(413).send({ error: err instanceof Error ? err.message : "Upload fehlgeschlagen" });
      }
    });
  });

  const idOf = (params: unknown) => AttachmentId.safeParse((params as { id?: string }).id);

  app.get("/api/attachments/:id", async (req, reply) => {
    const id = idOf(req.params);
    const record = id.success ? deps.attachments.get(id.data) : undefined;
    return record ?? reply.code(404).send({ error: "unknown attachment" });
  });

  app.get("/api/attachments/:id/content", async (req, reply) => {
    const id = idOf(req.params);
    const record = id.success ? deps.attachments.get(id.data) : undefined;
    if (!record) return reply.code(404).send({ error: "unknown attachment" });
    const { readFile } = await import("node:fs/promises");
    return reply
      .type(record.mimeType)
      .header("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(record.name)}`)
      .header("x-content-type-options", "nosniff")
      .send(await readFile(deps.attachments.pathOf(record.id)));
  });

  app.get("/api/attachments/:id/text", async (req, reply) => {
    const id = idOf(req.params);
    const record = id.success ? await deps.attachments.settled(id.data, 30_000) : undefined;
    if (!record) return reply.code(404).send({ error: "unknown attachment" });
    return { extraction: record.extraction, text: await deps.attachments.text(record.id) };
  });

  app.post("/api/attachments/:id/extract", async (req, reply) => {
    const id = idOf(req.params);
    const record = id.success ? await deps.attachments.reextract(id.data) : undefined;
    return record ?? reply.code(404).send({ error: "unknown attachment" });
  });

  app.get("/api/settings", async () => {
    const gemini = deps.settings.gemini();
    return { gemini: { configured: Boolean(gemini), model: deps.settings.get("gemini.model") ?? DEFAULT_GEMINI_MODEL } };
  });

  app.put("/api/settings/gemini", async (req, reply) => {
    const body = z.object({ apiKey: z.string().trim().min(10).max(200).nullable().optional(), model: z.string().trim().min(1).max(100).optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid gemini settings" });
    if (body.data.apiKey !== undefined) deps.settings.set("gemini.apiKey", body.data.apiKey);
    if (body.data.model !== undefined) deps.settings.set("gemini.model", body.data.model);
    const gemini = deps.settings.gemini();
    return { gemini: { configured: Boolean(gemini), model: deps.settings.get("gemini.model") ?? DEFAULT_GEMINI_MODEL } };
  });
}
