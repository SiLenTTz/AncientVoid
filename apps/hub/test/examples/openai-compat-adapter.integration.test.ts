import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { AdapterRegistry, EventStore, HubDatabase, SessionManager, TokenService } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import { createHubApp } from "../../src/app.ts";

/**
 * BUG-0131/BUG-0144: das OpenAI-Beispiel, geladen wie `setup.sh` es registriert, liefert im Hub
 * Antworten und Endpoint-Fehler als Events — auch beim Folgeprompt.
 */
const REPO = resolve(import.meta.dirname, "../../../..");
const sse = (body: string) => new Response(new Blob([body]).stream(), { status: 200, headers: { "content-type": "text/event-stream" } });

describe("examples/openai-compat im Hub (BUG-0131, BUG-0144)", () => {
  let dir: string;
  let app: FastifyInstance;
  let sessions: SessionManager;
  let auth: { authorization: string };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-openai-compat-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    await registry.load(
      { id: "local-llm", module: "./examples/adapters/openai-compat/adapter.ts", config: { baseUrl: "http://127.0.0.1:9/v1", model: "test" }, enabled: true },
      join(REPO, "ancientvoid.config.json"),
    );
    sessions = new SessionManager(db, store, registry, new ProcessRunner());
    const tokens = new TokenService(db);
    auth = { authorization: `Bearer ${tokens.issue("test-device").token}` };
    app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false }, store });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await sessions.shutdown();
    await app.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  });

  const events = async (id: string) =>
    (await app.inject({ method: "GET", url: `/api/sessions/${id}/events`, headers: auth })).json() as { type: string; summary: string }[];

  async function until(id: string, predicate: (evs: { type: string; summary: string }[]) => boolean) {
    const t0 = Date.now();
    for (;;) {
      const evs = await events(id);
      if (predicate(evs)) return evs;
      if (Date.now() - t0 > 3000) throw new Error(`timeout: ${JSON.stringify(evs.map((e) => e.summary))}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  it("Antwort, unlesbare Zeile und Folgeprompt-Fehler landen im Ereignisstrom", async () => {
    vi.stubGlobal("fetch", async () => sse(`data: INVALID\n\ndata: {"choices":[{"delta":{"content":"hallo"}}]}\n\ndata: [DONE]\n\n`));
    const res = await app.inject({ method: "POST", url: "/api/sessions", headers: auth, payload: { adapter: "local-llm", project: dir, prompt: "hi" } });
    expect(res.statusCode).toBe(201);
    const id = (res.json() as { id: string }).id;
    const first = await until(id, (evs) => evs.some((e) => e.summary === "completion finished"));
    expect(first.some((e) => e.type === "assistant" && e.summary === "hallo")).toBe(true);
    expect(first.some((e) => e.type === "error" && /unlesbare Antwortzeile/.test(e.summary))).toBe(true);

    vi.stubGlobal("fetch", async () => {
      throw new Error("synthetic offline");
    });
    const steer = await app.inject({ method: "POST", url: `/api/sessions/${id}/steer`, headers: auth, payload: { kind: "prompt", text: "weiter" } });
    expect(steer.statusCode).toBeLessThan(300);
    await until(id, (evs) => evs.some((e) => e.type === "error" && /synthetic offline/.test(e.summary)));
  });
});
