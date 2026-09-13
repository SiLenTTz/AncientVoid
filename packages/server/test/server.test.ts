import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { WebSocket } from "ws";
import { EventStore, SessionManager, AdapterRegistry, HubDatabase, TokenService } from "@uacc/core";
import { ProcessRunner } from "@uacc/workers";
import { createAdapter as createDummy } from "@uacc/adapter-dummy";
import { createHubApp } from "../src/index.ts";

describe("hub server", () => {
  let dir: string;
  let app: FastifyInstance;
  let token: string;
  let baseUrl: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "uacc-srv-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 10, autoStopAfterEvents: 25 });
    const sessions = new SessionManager(db, store, registry, new ProcessRunner());
    const tokens = new TokenService(db);
    token = tokens.issue("test-device").token;
    app = await createHubApp({
      sessions,
      tokens,
      registry,
      auth: { tokens, enforceTailnetIdentity: false },
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    baseUrl = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await app.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  });

  it("health stays open without auth (tailnet monitoring)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("rejects requests without device token (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sessions" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects invalid tokens (401)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/sessions",
      headers: { authorization: "Bearer wrong" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("accepts valid device tokens", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/sessions",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("creates a session via POST /api/sessions", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { authorization: `Bearer ${token}` },
      payload: { adapter: "dummy", project: dir },
    });
    expect(res.statusCode).toBe(201);
    const record = res.json() as { id: string; status: string };
    expect(record.status).toBe("working");
  });

  it("rejects invalid session specs (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { authorization: `Bearer ${token}` },
      payload: { adapter: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("enforces tailnet identity when configured", async () => {
    const db = new HubDatabase(":memory:");
    const tokens = new TokenService(db);
    const t = tokens.issue("tailnet-test").token;
    const strictApp = await createHubApp({
      sessions: new SessionManager(
        db,
        new EventStore(join(dir, "strict")),
        new AdapterRegistry(),
        new ProcessRunner(),
      ),
      tokens,
      registry: new AdapterRegistry(),
      auth: { tokens, enforceTailnetIdentity: true },
    });
    const noHeader = await strictApp.inject({
      method: "GET",
      url: "/api/sessions",
      headers: { authorization: `Bearer ${t}` },
    });
    expect(noHeader.statusCode).toBe(401);
    const withHeader = await strictApp.inject({
      method: "GET",
      url: "/api/sessions",
      headers: { authorization: `Bearer ${t}`, "tailscale-user-login": "jan@tailnet" },
    });
    expect(withHeader.statusCode).toBe(200);
    await strictApp.close();
  });

  it("WS tail: hello → events flow with gapless seq deltas", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { authorization: `Bearer ${token}` },
      payload: { adapter: "dummy", project: dir },
    });
    const { id } = created.json() as { id: string };
    const wsUrl = baseUrl.replace("http", "ws");
    const ws = new WebSocket(`${wsUrl}/api/events/${id}/tail?token=${token}`);
    const received: { type: string; events?: { seq: number }[]; highWater?: number }[] = [];
    const done = new Promise<void>((resolve, reject) => {
      ws.on("error", reject);
      ws.on("message", (raw: Buffer) => {
        const msg = JSON.parse(String(raw)) as { type: string; events?: { seq: number }[] };
        received.push(msg);
        if (received.filter((m) => m.type === "events" && (m.events?.length ?? 0) > 0).length >= 2) {
          ws.close();
          resolve();
        }
      });
      ws.on("open", () => ws.send(JSON.stringify({ type: "hello", lastSeq: 0 })));
      setTimeout(() => reject(new Error("ws timeout")), 8000);
    });
    await done;

    const eventBatches = received.filter((m) => m.type === "events");
    let prev = 0;
    for (const batch of eventBatches) {
      for (const e of batch.events ?? []) {
        expect(e.seq).toBe(prev + 1);
        prev = e.seq;
      }
    }
    expect(prev).toBeGreaterThan(2);
  });

  it("WS resync: client-requested replay from store fills gaps", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { authorization: `Bearer ${token}` },
      payload: { adapter: "dummy", project: dir },
    });
    const { id } = created.json() as { id: string };
    await new Promise((r) => setTimeout(r, 400));
    const wsUrl = baseUrl.replace("http", "ws");
    const ws = new WebSocket(`${wsUrl}/api/events/${id}/tail?token=${token}`);
    const resynced = new Promise<void>((resolve, reject) => {
      ws.on("error", reject);
      ws.on("message", (raw: Buffer) => {
        const msg = JSON.parse(String(raw)) as { type: string; events?: { seq: number }[] };
        if (msg.type === "events" && (msg.events?.length ?? 0) > 3) {
          const seqs = (msg.events ?? []).map((e) => e.seq);
          expect(seqs[0]).toBe(1); // resync from 0 replays from the first event
          ws.close();
          resolve();
        }
      });
      ws.on("open", () => ws.send(JSON.stringify({ type: "resync", since: 0 })));
      setTimeout(() => reject(new Error("ws resync timeout")), 8000);
    });
    await resynced;
  });
});
