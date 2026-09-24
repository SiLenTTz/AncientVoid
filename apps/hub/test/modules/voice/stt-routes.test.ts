import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, ApprovalService, EventStore, HubDatabase, SessionManager, TokenService } from "@uacc/core";
import { ProcessRunner } from "@uacc/workers";
import type { FastifyInstance } from "fastify";
import { createHubApp } from "../../../src/app.ts";
import { projectVocabulary } from "../../../src/modules/voice/stt.routes.ts";

/** A 16 kHz mono 16-bit WAV of `ms` silence — what whisper-server wants. */
function wav(ms: number): Buffer {
  const data = Buffer.alloc(Math.round((ms / 1000) * 32_000));
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16_000, 24);
  h.writeUInt32LE(32_000, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** T10.2 (ADR-0028): recording in, editable text out — nothing sent or run. */
describe("local speech-to-text route (T10.2)", () => {
  let dir: string;
  let app: FastifyInstance;
  let sessions: SessionManager;
  let human: string;
  let agent: string;
  let upstream: { status: number; body: unknown };
  const seen: string[] = [];

  async function build(withStt: boolean) {
    dir = await mkdtemp(join(tmpdir(), "uacc-stt-"));
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    const tokens = new TokenService(db);
    sessions = new SessionManager(db, new EventStore(join(dir, ".data")), registry, new ProcessRunner());
    const fetchFake = (async (_url: string, init?: RequestInit) => {
      seen.push(Buffer.from(init?.body as Buffer).toString("latin1"));
      return new Response(JSON.stringify(upstream.body), { status: upstream.status });
    }) as unknown as typeof fetch;
    const stt = withStt ? { url: "http://stt/inference", engine: "whisper-test", language: "de", vocabulary: "Worktree, Vitest", timeoutMs: 5_000, fetch: fetchFake } : undefined;
    app = await createHubApp({ sessions, tokens, registry, approvals: new ApprovalService(db), auth: { tokens, enforceTailnetIdentity: false }, projectRoots: [], ...(stt ? { stt } : {}) });
    human = tokens.issue("pixel").token;
    agent = tokens.issue("agent:mcp").token;
  }
  const post = (token: string, body: Buffer, type = "audio/wav") => app.inject({ method: "POST", url: "/api/stt", headers: { authorization: `Bearer ${token}`, "content-type": type }, payload: body });

  beforeEach(() => {
    upstream = { status: 200, body: { text: "  Starte die Tests\n im Worktree " } };
    seen.length = 0;
  });
  afterEach(async () => {
    await sessions.shutdown();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("a WAV goes to the recogniser with language and vocabulary; the text comes back tidy with timings", async () => {
    await build(true);
    const status = await app.inject({ method: "GET", url: "/api/stt", headers: { authorization: `Bearer ${human}` } });
    expect(status.json()).toMatchObject({ available: true, engine: "whisper-test", local: true });
    const res = await post(human, wav(1000));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ text: "Starte die Tests im Worktree", engine: "whisper-test", audioMs: 1000 });
    expect(seen[0]).toMatch(/name="language"\r\n\r\nde/);
    expect(seen[0]).toMatch(/name="prompt"\r\n\r\nWorktree, Vitest/);
    expect(seen[0]).toContain("RIFF");
    // Transcribing starts nothing: no session, no event.
    expect(sessions.list()).toHaveLength(0);
  });

  it("an agent token may not transcribe (voice.transcribe is a person's channel)", async () => {
    await build(true);
    expect((await post(agent, wav(500))).statusCode).toBe(403);
    expect(seen).toHaveLength(0);
  });

  it("fails loud: no recogniser 501, no recording 400, unreadable audio 422, recogniser down 502", async () => {
    await build(false);
    expect((await app.inject({ method: "GET", url: "/api/stt", headers: { authorization: `Bearer ${human}` } })).json()).toEqual({ available: false });
    expect((await post(human, wav(500))).statusCode).toBe(501);
    await app.close();
    await sessions.shutdown();
    await rm(dir, { recursive: true, force: true });
    await build(true);
    expect((await post(human, Buffer.alloc(10))).statusCode).toBe(400);
    expect((await post(human, Buffer.alloc(4000, 7), "audio/webm")).statusCode).toBe(422);
    upstream = { status: 500, body: { error: "boom" } };
    const down = await post(human, wav(500));
    expect(down.statusCode).toBe(502);
    expect(down.json().error).toMatch(/bitte tippen/);
  });

  it("project names become vocabulary, spoken and written alike", () => {
    expect(projectVocabulary(["/home/x/mobile-hub", "/srv/custom-rag/", "/a/b/mobile-hub", "/x"])).toBe("mobile-hub, custom-rag");
  });
});
