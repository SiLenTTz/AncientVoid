import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
