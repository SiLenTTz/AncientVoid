import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { MAIN_SYNC_DEFAULTS } from "@ancientvoid/contracts";
import { EventStore, HubDatabase, MainSyncSettingsService, SessionManager, SettingsStore, AdapterRegistry, TokenService } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import { createHubApp } from "../../../src/app.ts";

/** EPIC-P67 T67.3: GET/PUT /api/settings/main-sync — Speicher, Validierung, Policy (ADR-0088 §5). */
describe("main-sync settings routes", () => {
  let dir: string;
  let app: FastifyInstance;
  let sessions: SessionManager;
  let tokens: TokenService;
  let human: string;
  let agent: string;
  let mainSync: MainSyncSettingsService;

  async function call(method: "GET" | "PUT", url: string, token: string, payload?: unknown) {
    const res = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });
    return { status: res.statusCode, body: res.json() as Record<string, unknown> };
  }

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-mainsync-routes-"));
    const db = new HubDatabase(":memory:");
    tokens = new TokenService(db);
    const registry = new AdapterRegistry();
    sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    mainSync = new MainSyncSettingsService(new SettingsStore(db));
    app = await createHubApp({
      sessions,
      tokens,
      registry,
      auth: { tokens, enforceTailnetIdentity: false },
      mainSync,
    });
    human = tokens.issue("pixel").token;
    agent = tokens.issue("agent:mcp").token;
  });

  afterAll(async () => {
    await sessions.shutdown();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("GET: leerer Speicher antwortet mit Defaults (fallback missing), keine Overrides", async () => {
    const res = await call("GET", "/api/settings/main-sync", human);
    expect(res.status).toBe(200);
    expect(res.body.global).toEqual({ value: MAIN_SYNC_DEFAULTS, fallback: "missing" });
    expect(res.body.projects).toEqual({ value: {}, fallback: "missing" });
  });

  it("PUT setzt global + Projekt-Override, GET liest beides zurück (K7: gleicher Speicher)", async () => {
    const changed = { ...MAIN_SYNC_DEFAULTS, checkIntervalMin: 30, behindAction: "ask" as const };
    const put = await call("PUT", "/api/settings/main-sync", human, { global: changed, projects: { "/projekte/alpha": { startSync: "off" } } });
    expect(put.status).toBe(200);
    expect(put.body.global).toEqual({ value: changed, fallback: "none" });
    const got = await call("GET", "/api/settings/main-sync", human);
    expect(got.body.projects).toEqual({ value: { "/projekte/alpha": { startSync: "off" } }, fallback: "none" });
    // effektive Sicht über den Service: Override schlägt global
    expect(mainSync.effective("/projekte/alpha").startSync).toBe("off");
    expect(mainSync.effective("/projekte/alpha").checkIntervalMin).toBe(30);
  });

  it("PUT mit ungültigen Werten: 400 mit benannten Issues — nichts gespeichert", async () => {
    const before = await call("GET", "/api/settings/main-sync", human);
    const bad = await call("PUT", "/api/settings/main-sync", human, {
      global: { ...MAIN_SYNC_DEFAULTS, checkIntervalMin: 3, onlyWhenIdle: false },
      projects: {},
    });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body.issues)).toContain("checkIntervalMin");
    const after = await call("GET", "/api/settings/main-sync", human);
    expect(after.body).toEqual(before.body);
  });

  it("PUT lehnt unbekannte Felder ab (strict)", async () => {
    const bad = await call("PUT", "/api/settings/main-sync", human, { global: { ...MAIN_SYNC_DEFAULTS, turbo: true }, projects: {} });
    expect(bad.status).toBe(400);
  });

  it("Policy settings.manage: Lesen ist generisch erlaubt (wie /api/settings), Agenten schreiben nicht (403)", async () => {
    expect((await call("GET", "/api/settings/main-sync", agent)).status).toBe(200);
    expect((await call("PUT", "/api/settings/main-sync", agent, { global: MAIN_SYNC_DEFAULTS, projects: {} })).status).toBe(403);
  });

  it("ohne mainSync-Dep antwortet die Route ehrlich 501", async () => {
    const localTokens = new TokenService(new HubDatabase(":memory:"));
    const db2 = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    const bare = await createHubApp({
      sessions: new SessionManager(db2, new EventStore(dir), registry, new ProcessRunner()),
      tokens: localTokens,
      registry,
      auth: { tokens: localTokens, enforceTailnetIdentity: false },
    });
    const res = await bare.inject({ method: "GET", url: "/api/settings/main-sync", headers: { authorization: `Bearer ${localTokens.issue("pixel").token}` } });
    expect(res.statusCode).toBe(501);
    await bare.close();
  });
});
