import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, ApprovalService, AttachmentStore, EventStore, HubDatabase, MediaJobs, SessionManager, SettingsStore, TokenService } from "@uacc/core";
import { ProcessRunner } from "@uacc/workers";
import type { FastifyInstance } from "fastify";
import { createHubApp } from "../../../src/app.ts";

const FIXTURE = join(import.meta.dirname, "../../../../../packages/core/test/fixtures/media/slides.mp4");

/** EPIC-P10.5 (ADR-0030): the media routes around real ffmpeg, with a stand-in for speech. */
describe("media routes (T10.5.1/T10.5.6)", () => {
  let dir: string;
  let app: FastifyInstance;
  let sessions: SessionManager;
  let media: MediaJobs;
  let human: string;
  let agent: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "uacc-media-routes-"));
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    const tokens = new TokenService(db);
    const settings = new SettingsStore(db);
    const attachments = new AttachmentStore(db, join(dir, "attachments"));
    sessions = new SessionManager(db, new EventStore(join(dir, ".data")), registry, new ProcessRunner());
    const stt = (async () => new Response(JSON.stringify({ segments: [{ start: 6.1, end: 9, text: "Tests mit npm." }] }), { status: 200 })) as unknown as typeof fetch;
    media = new MediaJobs(db, { dir: join(dir, "media"), attachments, stt: { url: "http://127.0.0.1:1/inference", fetch: stt }, limits: { maxBytes: 200_000 } });
    app = await createHubApp({ sessions, tokens, registry, approvals: new ApprovalService(db), attachments, settings, auth: { tokens, enforceTailnetIdentity: false }, media: { media, capabilities: { stt: true, summary: false, vision: false } } });
    human = tokens.issue("pixel").token;
    agent = tokens.issue("agent:mcp").token;
  });

  afterEach(async () => {
    await media.idle();
    await sessions.shutdown();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  it("upload streams to disk, the job runs, frames and the result are served; the raw video is not", async () => {
    const caps = await app.inject({ method: "GET", url: "/api/media", headers: auth(human) });
    expect(caps.json()).toMatchObject({ available: true, stt: true, summary: false, gemini: false, limits: { maxBytes: 200_000 } });
    const up = await app.inject({ method: "POST", url: "/api/media/upload?language=de", headers: { ...auth(human), "content-type": "video/mp4", "x-filename": encodeURIComponent("Folien ä.mp4") }, payload: await readFile(FIXTURE) });
    expect(up.statusCode).toBe(201);
    const job = up.json() as { id: string; source: { name: string }; language: string };
    expect(job).toMatchObject({ source: { name: "Folien ä.mp4" }, language: "de" });
    const early = await app.inject({ method: "GET", url: `/api/media/jobs/${job.id}/result`, headers: auth(human) });
    expect([200, 409]).toContain(early.statusCode);
    await media.idle();
    const done = (await app.inject({ method: "GET", url: `/api/media/jobs/${job.id}`, headers: auth(human) })).json() as { status: string; resultAttachmentId: string };
    expect(done.status).toBe("done");
    const result = (await app.inject({ method: "GET", url: `/api/media/jobs/${job.id}/result`, headers: auth(human) })).json() as { transcript: { text: string }[]; frames: { file: string }[]; notes: string[] };
    expect(result.transcript[0]!.text).toBe("Tests mit npm.");
    expect(result.notes.join(" ")).toMatch(/kein lokales Modell/);
    const frame = await app.inject({ method: "GET", url: `/api/media/jobs/${job.id}/frames/${result.frames[0]!.file}`, headers: auth(human) });
    expect(frame.statusCode).toBe(200);
    expect(frame.headers["content-type"]).toBe("image/jpeg");
    for (const bad of ["../result.json", "source.mp4", "frame_1.jpg"]) {
      expect((await app.inject({ method: "GET", url: `/api/media/jobs/${job.id}/frames/${encodeURIComponent(bad)}`, headers: auth(human) })).statusCode, bad).toBe(404);
    }
    // The result is an ordinary attachment — a session can take it.
    const att = await app.inject({ method: "GET", url: `/api/attachments/${done.resultAttachmentId}`, headers: auth(human) });
    expect(att.json()).toMatchObject({ mimeType: "text/markdown", kind: "text" });
    const list = (await app.inject({ method: "GET", url: "/api/media/jobs", headers: auth(human) })).json() as unknown[];
    expect(list).toHaveLength(1);
    expect((await app.inject({ method: "DELETE", url: `/api/media/jobs/${job.id}`, headers: auth(human) })).json()).toEqual({ ok: true });
    expect((await app.inject({ method: "GET", url: `/api/media/jobs/${job.id}`, headers: auth(human) })).statusCode).toBe(404);
  }, 60_000);

  it("refuses in words: too large, empty, local links, neither/both sources; agents may not start jobs", async () => {
    const big = await app.inject({ method: "POST", url: "/api/media/upload", headers: { ...auth(human), "content-type": "video/mp4" }, payload: Buffer.alloc(300_000, 1) });
    expect(big.statusCode).toBe(413);
    expect(big.json().error).toMatch(/zu groß/);
    expect((await app.inject({ method: "POST", url: "/api/media/upload", headers: { ...auth(human), "content-type": "video/mp4" }, payload: Buffer.alloc(0) })).statusCode).toBe(400);
    const local = await app.inject({ method: "POST", url: "/api/media/jobs", headers: auth(human), payload: { url: "http://127.0.0.1:7373/secret" } });
    expect(local.statusCode).toBe(400);
    expect(local.json().error).toMatch(/Lokale Adressen/);
    expect((await app.inject({ method: "POST", url: "/api/media/jobs", headers: auth(human), payload: {} })).json().error).toMatch(/entweder ein Link oder eine Datei/);
    expect((await app.inject({ method: "POST", url: "/api/media/jobs", headers: auth(human), payload: { url: "ftp://x.org/a" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/media/jobs", headers: auth(agent), payload: { url: "https://www.youtube.com/watch?v=x" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/media/upload", headers: { ...auth(agent), "content-type": "video/mp4" }, payload: Buffer.alloc(10, 1) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/media/jobs/../../etc", headers: auth(human) })).statusCode).toBe(404);
    expect(media.list()).toHaveLength(0);
  });
});
