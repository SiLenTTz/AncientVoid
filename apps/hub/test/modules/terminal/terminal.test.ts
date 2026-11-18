import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { AdapterRegistry, EventStore, HubDatabase, SessionManager, TokenService } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import type { FastifyInstance } from "fastify";
import { createHubApp } from "../../../src/app.ts";

describe("terminal routes (ADR-0087)", () => {
  let dir: string;
  let app: FastifyInstance;
  let sessions: SessionManager;
  let token: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-term-"));
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    const tokens = new TokenService(db);
    sessions = new SessionManager(db, new EventStore(join(dir, "data")), registry, new ProcessRunner());
    app = await createHubApp({
      sessions,
      tokens,
      registry,
      auth: { tokens, enforceTailnetIdentity: false },
      terminals: [
        { id: "hub", label: "Hub-Host", local: true },
        { id: "evo", label: "evox2", ssh: "evo" },
      ],
    });
    token = tokens.issue("pixel").token;
  });

  afterEach(async () => {
    await sessions.shutdown();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("GET /api/terminals listet nur die Allowlist", async () => {
    const res = await app.inject({ method: "GET", url: "/api/terminals", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      terminals: [
        { id: "hub", label: "Hub-Host", local: true },
        { id: "evo", label: "evox2", ssh: "evo" },
      ],
    });
  });

  it("Ticket braucht Auth und bekannte id", async () => {
    const noAuth = await app.inject({ method: "POST", url: "/api/terminals/hub/ticket", payload: {} });
    expect(noAuth.statusCode).toBe(401);
    const missing = await app.inject({
      method: "POST",
      url: "/api/terminals/nope/ticket",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(missing.statusCode).toBe(404);
    const ok = await app.inject({
      method: "POST",
      url: "/api/terminals/hub/ticket",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(ok.statusCode).toBe(201);
    const body = ok.json() as { ticket: string; expiresAt: number };
    expect(body.ticket.length).toBeGreaterThan(20);
    expect(body.expiresAt).toBeGreaterThan(Date.now());
  });

  it("Stream: Ticket-WS kommt durch die Auth (Browser sends no Bearer)", async () => {
    // BUG: Browser-WebSockets können keinen Authorization-Header tragen. Der
    // Upgrade auf /api/terminals/:id/stream muss wie bei STT am authHook
    // vorbeikommen; das kurzlebige Ticket authentifiziert die Route selbst.
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.addresses()[0] as { address: string; port: number };
    const base = `http://${address.address}:${address.port}`;
    const res = await fetch(`${base}/api/terminals/hub/ticket`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(201);
    const { ticket } = (await res.json()) as { ticket: string };
    const ws = new WebSocket(`${base.replace("http", "ws")}/api/terminals/hub/stream?ticket=${encodeURIComponent(ticket)}&cols=80&rows=24`);
    const outcome = await new Promise<{ code: number; reason: string; opened: boolean; firstFrame: string | null }>((resolve) => {
      let opened = false;
      const timer = setTimeout(() => resolve({ code: -1, reason: "timeout", opened, firstFrame: null }), 10_000);
      ws.on("open", () => {
        opened = true;
      });
      ws.on("message", (raw) => {
        clearTimeout(timer);
        ws.close(1000, "test done");
        resolve({ code: 1000, reason: "", opened, firstFrame: String(raw) });
      });
      ws.on("unexpected-response", (_req, resp) => {
        clearTimeout(timer);
        resolve({ code: resp.statusCode ?? 0, reason: "http rejected", opened: false, firstFrame: null });
      });
      ws.on("close", (code, reason) => {
        clearTimeout(timer);
        if (!opened) resolve({ code, reason: String(reason), opened, firstFrame: null });
      });
    });
    expect(outcome.opened, `WS upgrade durch die Auth: ${JSON.stringify(outcome)}`).toBe(true);
    expect(outcome.firstFrame).toContain("\"t\":\"o\"");
    await new Promise((done) => ws.on("close", () => done(null)));
  });

  it("Stream: abgelaufenes/falsches Ticket wird abgewiesen", async () => {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.addresses()[0] as { address: string; port: number };
    const base = `ws://${address.address}:${address.port}`;
    const ws = new WebSocket(`${base}/api/terminals/hub/stream?ticket=falsch&cols=80&rows=24`);
    const code = await new Promise<number>((resolve) => {
      ws.on("close", (c) => resolve(c));
      ws.on("unexpected-response", (_req, resp) => resolve(resp.statusCode ?? 0));
    });
    expect(code).toBe(4401);
  });

  it("ohne terminals[]: leere Liste", async () => {
    await sessions.shutdown();
    await app.close();
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    const tokens = new TokenService(db);
    sessions = new SessionManager(db, new EventStore(join(dir, "data2")), registry, new ProcessRunner());
    app = await createHubApp({
      sessions,
      tokens,
      registry,
      auth: { tokens, enforceTailnetIdentity: false },
    });
    const t = tokens.issue("pixel2").token;
    const res = await app.inject({ method: "GET", url: "/api/terminals", headers: { authorization: `Bearer ${t}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ terminals: [] });
  });
});
