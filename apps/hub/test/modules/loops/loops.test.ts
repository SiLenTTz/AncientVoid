import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, EventStore, HubDatabase, SessionManager, TokenService } from "@uacc/core";
import { createAdapter as createDummy } from "@uacc/adapter-dummy";
import { ProcessRunner } from "@uacc/workers";
import type { FastifyInstance } from "fastify";
import { createHubApp } from "../../../src/app.ts";

/** EPIC-P19 T19.3: Loop-Katalog und Start-Policy. */
describe("loops (EPIC-P19)", () => {
  let dir: string;
  let app: FastifyInstance;
  let sessions: SessionManager;
  let human: string;
  let agent: string;

  async function call(method: "GET" | "POST", url: string, token: string, payload?: unknown) {
    const res = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });
    return { status: res.statusCode, body: res.json() as never as Record<string, unknown> & unknown[] };
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "uacc-loops-"));
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 1, autoStopAfterEvents: 0 });
    const tokens = new TokenService(db);
    sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false }, projectRoots: [dir] });
    human = tokens.issue("pixel").token;
    agent = tokens.issue("agent:mcp").token;
  });

  afterEach(async () => {
    await sessions.shutdown();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("GET /api/loops nennt beide Loops, ehrlich als nicht startbar und mit Grund", async () => {
    const res = await call("GET", "/api/loops", human);
    expect(res.status).toBe(200);
    const loops = res.body as unknown as { id: string; label: string; available: boolean; reason?: string; options: { key: string }[] }[];
    expect(loops.map((l) => l.id)).toEqual(["aspark-factory", "securesight-factory"]);
    expect(loops.every((l) => !l.available && (l.reason ?? "").includes("Connector"))).toBe(true);
    expect(loops.find((l) => l.id === "securesight-factory")?.options[0]?.key).toBe("orchestrator");
    expect(JSON.stringify(loops)).not.toMatch(/password|secret|token/i);
  });

  it("ein Start mit nicht angebundenem Loop wird laut abgelehnt, es entsteht keine Session", async () => {
    const res = await call("POST", "/api/sessions", human, { adapter: "dummy", project: dir, loop: { id: "aspark-factory" } });
    expect(res.status).toBe(422);
    expect(String(res.body.error)).toContain("aSPARK-Factory");
    expect(String(res.body.error)).toContain("Connector");
    expect(sessions.list()).toHaveLength(0);
  });

  it("ein unbekannter Loop ist 422, eine kaputte Kennung 400", async () => {
    expect((await call("POST", "/api/sessions", human, { adapter: "dummy", project: dir, loop: { id: "gibtsnicht" } })).status).toBe(422);
    expect((await call("POST", "/api/sessions", human, { adapter: "dummy", project: dir, loop: { id: "../x" } })).status).toBe(400);
  });

  it("AC-P19-8: ein Agenten-Token kann keinen Loop starten, auch nicht beantragen", async () => {
    const res = await call("POST", "/api/sessions", agent, { adapter: "dummy", project: dir, loop: { id: "securesight-factory" } });
    expect(res.status).toBe(403);
    expect(sessions.list()).toHaveLength(0);
  });

  it("AC-P19-5: ohne Loop startet die Session wie vorher", async () => {
    const res = await call("POST", "/api/sessions", human, { adapter: "dummy", project: dir, prompt: "hallo" });
    expect(res.status).toBe(201);
  });
});
