import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { EventStore, HubDatabase, SessionManager, AdapterRegistry, TokenService, InMemoryMetrics } from "@uacc/core";
import { ProcessRunner } from "@uacc/workers";
import { createAdapter as createDummy } from "@uacc/adapter-dummy";
import { createHubApp } from "../src/index.ts";

describe("observability endpoints (T4.5-4 / AC-P4.5-2)", () => {
  let dir: string;
  let app: FastifyInstance;
  let token: string;
  let metrics: InMemoryMetrics;
  let sessions: SessionManager;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "uacc-obs-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 20, autoStopAfterEvents: 8 });
    metrics = new InMemoryMetrics();
    sessions = new SessionManager(db, store, registry, new ProcessRunner(), undefined, undefined, undefined, null, [], {
      metrics,
    });
    const tokens = new TokenService(db);
    token = tokens.issue("obs-device").token;
    app = await createHubApp({
      sessions,
      tokens,
      registry,
      auth: { tokens, enforceTailnetIdentity: false },
      store,
      metrics,
      startedAt: Date.now() - 2000,
    });
  });

  afterAll(async () => {
    await sessions.shutdown().catch(() => undefined);
    await app.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  });

  it("health stays open and reports checks + session counts", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health?probe=1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("ok");
    expect(body.checks.database.ok).toBe(true);
    expect(body.checks.eventStore.ok).toBe(true);
    expect(body.sessions).toEqual({ live: 0, total: 0, byStatus: {} });
    expect(body.adapters.some((a: { id: string }) => a.id === "dummy")).toBe(true);
    expect(typeof body.serverTime).toBe("string");
    expect(body.uptimeSec).toBeGreaterThanOrEqual(2);
  });

  it("ready stays open and is 200 when checks pass", async () => {
    const res = await app.inject({ method: "GET", url: "/api/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("metrics requires a token", async () => {
    const denied = await app.inject({ method: "GET", url: "/api/metrics" });
    expect(denied.statusCode).toBe(401);
  });

  it("metrics counts events_appended after a dummy session", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { authorization: `Bearer ${token}` },
      payload: { adapter: "dummy", project: dir, prompt: "hi" },
    });
    expect(created.statusCode).toBe(201);
    const res = await app.inject({
      method: "GET",
      url: "/api/metrics",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.counters.sessions_started).toBeGreaterThanOrEqual(1);
    expect(body.counters.events_appended).toBeGreaterThanOrEqual(1);
    expect(body.gauges.sessions_live).toBeGreaterThanOrEqual(1);
  });
});

describe("ready 503 when a check is red (T4.5-4)", () => {
  it("returns 503 and ok:false when the event store probe throws", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uacc-ready-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    const sessions = new SessionManager(db, store, registry, new ProcessRunner());
    const tokens = new TokenService(db);
    const brokenStore = {
      probe: async () => {
        throw new Error("disk full");
      },
    };
    const app = await createHubApp({
      sessions,
      tokens,
      registry,
      auth: { tokens, enforceTailnetIdentity: false },
      store: brokenStore,
    });
    try {
      const res = await app.inject({ method: "GET", url: "/api/ready" });
      expect(res.statusCode).toBe(503);
      expect(res.json().ok).toBe(false);
      const health = await app.inject({ method: "GET", url: "/api/health" });
      expect(health.statusCode).toBe(200);
      expect(health.json().ok).toBe(false);
      expect(health.json().status).toBe("down");
    } finally {
      await sessions.shutdown().catch(() => undefined);
      await app.close().catch(() => undefined);
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
