import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, EventStore, HubDatabase, SessionManager, TokenService, type AiMetricsSampler } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import { AiMetricsReport } from "@ancientvoid/contracts";
import type { FastifyInstance } from "fastify";
import { createHubApp } from "../../../src/app.ts";

/** EPIC-P59 (ADR-0078): GET /api/aimetrics — normale API-Auth, Reportschema aus den Contracts. */
describe("GET /api/aimetrics (EPIC-P59)", () => {
  let dir: string;
  let app: FastifyInstance;
  let sessions: SessionManager;
  let tokens: TokenService;
  let token: string;

  async function buildApp(aimetrics?: AiMetricsSampler): Promise<FastifyInstance> {
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    tokens = new TokenService(db);
    sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    token = tokens.issue("pixel").token;
    return await createHubApp({ sessions, tokens, registry, ...(aimetrics ? { aimetrics } : {}), auth: { tokens, enforceTailnetIdentity: false } });
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-aimetrics-"));
    app = await buildApp();
  });

  afterEach(async () => {
    await sessions.shutdown();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("antwortet ohne Sampler mit leerer Quelle-Liste statt stiller Nullen", async () => {
    const res = await app.inject({ method: "GET", url: "/api/aimetrics", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(AiMetricsReport.parse(res.json()).sources).toEqual([]);
  });

  it("gibt den Sampler-Report unverändert durch (Contract-Stabilität)", async () => {
    await app.close();
    const fake: AiMetricsSampler = {
      start: () => undefined,
      stop: () => undefined,
      tickNow: async () => undefined,
      report: () => ({
        generatedAt: new Date().toISOString(),
        intervalSec: 10,
        windowSec: 900,
        self: { hostLabel: "test" },
        sources: [{ id: "s", kind: "model-server", label: "s", url: "http://x/v1", status: { ok: true }, lastSampleAt: null, fields: [] }],
      }),
    };
    app = await buildApp(fake);
    const res = await app.inject({ method: "GET", url: "/api/aimetrics", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(AiMetricsReport.parse(res.json()).sources).toHaveLength(1);
  });

  it("ohne Token: 401 (normale API-Auth, K5)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/aimetrics" });
    expect(res.statusCode).toBe(401);
  });
});
