import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { AdapterRegistry, ClaudeLive, EventStore, HubDatabase, SessionManager, TokenService } from "@ancientvoid/core";
import { basicFeatures, type Adapter } from "@ancientvoid/contracts";
import { ProcessRunner } from "@ancientvoid/workers";
import { createHubApp } from "../../../src/app.ts";

/** EPIC-P15 T15.4: GET /api/sessions/:id/pc — ist die Session am PC offen? */
describe("hub route — am PC offen", () => {
  let dir: string;
  let app: FastifyInstance;
  let token: string;
  const OPEN = "1619abc2-9ea6-48d7-8453-418cc0153dfd";

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-pc-open-"));
    const adapter: Adapter = {
      id: "claudish",
      version: "0.0.1",
      capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "native", features: basicFeatures() }),
      async start(_spec, ctx) {
        return { sessionId: ctx.sessionId };
      },
      async steer() {
        return { ok: true };
      },
      async status() {
        return { state: "healthy" };
      },
      async stop() {},
    };
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("claudish", () => adapter);
    const sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    const tokens = new TokenService(db);
    token = tokens.issue("test-device").token;
    const claudeLive = new ClaudeLive("claude", async () => JSON.stringify([{ pid: 4711, cwd: "/p/x", kind: "interactive", sessionId: OPEN, name: "AncientVoid-fc", status: "idle" }]));
    app = await createHubApp({ sessions, tokens, registry, claudeLive, auth: { tokens, enforceTailnetIdentity: false } });
  });

  afterAll(async () => {
    await app.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  });

  const get = (url: string) => app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
  const create = async (extra: Record<string, unknown> = {}) =>
    ((await app.inject({ method: "POST", url: "/api/sessions", headers: { authorization: `Bearer ${token}` }, payload: { adapter: "claudish", project: "/tmp", ...extra } })).json() as { id: string }).id;

  it("meldet eine am PC offene Session mit dem Namen der CLI", async () => {
    const id = await create({ adoptNativeSessionId: OPEN });
    expect((await get(`/api/sessions/${id}/pc`)).json()).toMatchObject({ open: true, kind: "interactive", name: "AncientVoid-fc", state: "idle" });
  });

  it("eine Session ohne Provider-ID oder mit einer anderen ist nicht offen", async () => {
    const plain = await create();
    expect((await get(`/api/sessions/${plain}/pc`)).json()).toEqual({ open: false });
    const other = await create({ adoptNativeSessionId: "00000000-0000-4000-8000-000000000000" });
    expect((await get(`/api/sessions/${other}/pc`)).json()).toEqual({ open: false });
  });

  it("eine unbekannte Session ist 404", async () => {
    expect((await get("/api/sessions/gibt-es-nicht/pc")).statusCode).toBe(404);
  });
});
