import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { basicFeatures, type Adapter } from "@ancientvoid/contracts";
import { AdapterRegistry, EventStore, HubDatabase, SessionManager, SettingsStore, TokenService } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import type { FastifyInstance } from "fastify";
import { createHubApp } from "../../../src/app.ts";

function adapter(id: string, models: Adapter["models"], modelChoice: "start" | "none" = "start"): Adapter {
  return {
    id,
    version: "0.0.1",
    capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures({ modelChoice }) }),
    ...(models ? { models } : {}),
    async start(_s, ctx) {
      return { sessionId: ctx.sessionId };
    },
    async steer() {
      return { ok: true };
    },
    async recover(sessionId) {
      return { sessionId };
    },
    async status() {
      return { state: "healthy" };
    },
    async stop() {},
  };
}

describe("eigene Modelle und Endpunkte (ADR-0060)", () => {
  let dir: string;
  let app: FastifyInstance;
  let sessions: SessionManager;
  let human: string;
  let agent: string;
  const savedPiDir = process.env.PI_CODING_AGENT_DIR;

  async function call(method: "GET" | "POST" | "DELETE", url: string, token: string, payload?: unknown) {
    const res = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });
    return { status: res.statusCode, body: res.json() as Record<string, unknown> };
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-models-"));
    process.env.PI_CODING_AGENT_DIR = join(dir, "pi-agent");
    const db = new HubDatabase(":memory:");
    const tokens = new TokenService(db);
    const registry = new AdapterRegistry();
    registry.register("pi", () => adapter("pi", async () => []));
    registry.register("maki", () => adapter("maki", async () => [{ id: "zai/glm-5.3" }]));
    registry.register("plain", () => adapter("plain", undefined, "none"));
    sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false }, projectRoots: [dir], settings: new SettingsStore(db) });
    human = tokens.issue("pixel").token;
    agent = tokens.issue("agent:mcp").token;
  });

  afterEach(async () => {
    if (savedPiDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = savedPiDir;
    await sessions.shutdown();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("ein eigenes Modell erscheint im Katalog der gewählten Harnesses, als eigenes markiert; Agenten dürfen es nicht anlegen", async () => {
    expect((await call("POST", "/api/models/custom", agent, { id: "anthropic/claude-opus-5-5" })).status).toBe(403);
    expect((await call("POST", "/api/models/custom", human, { id: "kaputt id" })).status).toBe(400);
    expect((await call("POST", "/api/models/custom", human, { id: "anthropic/claude-opus-5-5", label: "Opus 5.5", adapters: ["maki"] })).status).toBe(200);

    expect((await call("GET", "/api/adapters/pi/models", human)).body.models).toBeNull();
    const maki = (await call("GET", "/api/adapters/maki/models", human)).body;
    expect(maki.models).toEqual([{ id: "zai/glm-5.3" }, { id: "anthropic/claude-opus-5-5", label: "Opus 5.5" }]);
    expect(maki.customIds).toEqual(["anthropic/claude-opus-5-5"]);
    // Ein Harness ohne Modellwahl bekommt nie Einträge angezeigt.
    expect((await call("GET", "/api/adapters/plain/models", human)).body).toMatchObject({ models: null, customIds: [] });

    expect((await call("DELETE", "/api/models/custom?id=anthropic%2Fclaude-opus-5-5", agent)).status).toBe(403);
    expect((await call("DELETE", "/api/models/custom?id=anthropic%2Fclaude-opus-5-5", human)).status).toBe(200);
    expect((await call("GET", "/api/adapters/maki/models", human)).body.customIds).toEqual([]);
  });

  it("ein Endpunkt landet in pi's models.json und sofort im Katalog; Doppeltes braucht Bestätigung; andere Harnesses: 501", async () => {
    const provider = { name: "evo-evox2", baseUrl: "http://100.65.133.28:8100/v1", apiKey: "$EVOX2_KEY", models: [{ id: "halogen-qwen", name: "Halogen Qwen", contextWindow: 131072 }] };
    expect((await call("POST", "/api/adapters/pi/provider", agent, provider)).status).toBe(403);
    expect((await call("POST", "/api/adapters/maki/provider", human, provider)).status).toBe(501);
    expect((await call("POST", "/api/adapters/pi/provider", human, { ...provider, baseUrl: "file:///etc/passwd" })).status).toBe(400);

    expect((await call("POST", "/api/adapters/pi/provider", human, provider)).body).toMatchObject({ ok: true, created: true });
    const file = JSON.parse(await readFile(join(dir, "pi-agent", "models.json"), "utf8"));
    expect(file.providers["evo-evox2"].apiKey).toBe("$EVOX2_KEY");
    const pi = (await call("GET", "/api/adapters/pi/models", human)).body;
    expect(pi.models).toEqual([{ id: "evo-evox2/halogen-qwen", label: "Halogen Qwen" }]);
    expect(pi.customIds).toEqual(["evo-evox2/halogen-qwen"]);

    expect((await call("POST", "/api/adapters/pi/provider", human, provider)).status).toBe(409);
    expect((await call("POST", "/api/adapters/pi/provider", human, { ...provider, replace: true })).body).toMatchObject({ ok: true, created: false });
  });
});
