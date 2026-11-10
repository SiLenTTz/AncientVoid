import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { EventStore, SessionManager, AdapterRegistry, HubDatabase, TokenService } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import { createHubApp } from "../../src/app.ts";

/**
 * BUG-0108: policyHook brach bei leerem Label wie bei einer öffentlichen
 * Route ab — ein Token ohne Label erbte damit still die Human-Zeile der
 * Policy-Tabelle (actorKind("") === "human") und durfte Write-Klasse-
 * Operationen ausführen, die derselbe Actor-Typ sonst nicht darf.
 * Erwartet: fail closed — ein nicht zuordenbarer Token darf nichts.
 */
describe("policy: unattributable token (BUG-0108)", () => {
  let dir: string;
  let app: FastifyInstance;
  let humanToken: string;
  let agentToken: string;
  let emptyToken: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-policy-empty-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    const sessions = new SessionManager(db, store, registry, new ProcessRunner());
    const tokens = new TokenService(db);
    humanToken = tokens.issue("test-device").token;
    agentToken = tokens.issue("agent:test").token;
    emptyToken = tokens.issue("").token; // direct via TokenService — the API path requires min(1)
    app = await createHubApp({
      sessions,
      tokens,
      registry,
      auth: { tokens, enforceTailnetIdentity: false },
      store,
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
  });

  afterAll(async () => {
    await app.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  });

  it("agent token stays denied on tokens.manage (reference for the deny expectation)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/tokens", headers: { authorization: `Bearer ${agentToken}` }, payload: { label: "x" } });
    expect(res.statusCode).toBe(403);
  });

  it("empty-label token is denied on write-class operations instead of inheriting the human row", async () => {
    const res = await app.inject({ method: "POST", url: "/api/tokens", headers: { authorization: `Bearer ${emptyToken}` }, payload: { label: "x" } });
    expect(res.statusCode).toBe(403);
  });

  it("empty-label token is denied on reads as well — fail closed, nothing is public to it", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sessions", headers: { authorization: `Bearer ${emptyToken}` } });
    expect(res.statusCode).toBe(403);
  });

  it("human token still passes the same write-class route (guard against over-blocking)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/tokens", headers: { authorization: `Bearer ${humanToken}` }, payload: { label: "x" } });
    expect(res.statusCode).toBe(201);
  });
});
