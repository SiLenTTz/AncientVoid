import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, EventStore, HubDatabase, PushService, SessionManager, SettingsStore, TokenService } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import type { FastifyInstance } from "fastify";
import { createHubApp } from "../../../src/app.ts";

describe("push routes (T8.3)", () => {
  let dir: string;
  let app: FastifyInstance;
  let sessions: SessionManager;
  let human: string;
  let agent: string;
  let fleet: string;
  const sent: string[] = [];

  async function call(method: "GET" | "PUT" | "POST" | "DELETE", url: string, token: string, payload?: unknown) {
    const res = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });
    return { status: res.statusCode, body: res.json() as Record<string, unknown> };
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-push-"));
    const db = new HubDatabase(":memory:");
    const tokens = new TokenService(db);
    const registry = new AdapterRegistry();
    sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    const settings = new SettingsStore(db);
    const push = new PushService(db, settings, { sender: async (s) => (sent.push(s.endpoint), { statusCode: 201 }) });
    app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false }, projectRoots: [dir], settings, push });
    human = tokens.issue("pixel").token;
    agent = tokens.issue("agent:mcp").token;
    fleet = tokens.issue("fleet:workstation").token;
  });

  afterEach(async () => {
    await sessions.shutdown();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("a person turns push on, subscribes this device, sends a test; agents and the fleet may not", async () => {
    expect((await call("GET", "/api/push", human)).body).toMatchObject({ enabled: false, publicKey: null });
    expect((await call("PUT", "/api/push/enabled", agent, { enabled: true })).status).toBe(403);
    expect((await call("PUT", "/api/push/enabled", fleet, { enabled: true })).status).toBe(403);
    const on = await call("PUT", "/api/push/enabled", human, { enabled: true });
    expect(on.body.publicKey).toEqual(expect.any(String));
    const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/x1", keys: { p256dh: "p", auth: "a" } };
    expect((await call("POST", "/api/push/subscriptions", agent, sub)).status).toBe(403);
    expect((await call("POST", "/api/push/subscriptions", human, { ...sub, endpoint: "https://169.254.169.254/latest" })).status).toBe(422);
    expect((await call("POST", "/api/push/subscriptions", human, sub)).status).toBe(201);
    expect((await call("POST", "/api/push/test", human, {})).body).toMatchObject({ sent: 1 });
    expect(sent).toEqual(["https://fcm.googleapis.com/fcm/send/x1"]);
    const state = await call("GET", "/api/push", human);
    expect(state.body.subscriptions).toEqual([expect.objectContaining({ device: "pixel", service: "fcm.googleapis.com", mine: true })]);
    expect(JSON.stringify(state.body)).not.toContain("send/x1");
    expect((await call("DELETE", "/api/push/subscriptions", human, { endpoint: sub.endpoint })).body).toEqual({ ok: true });
  });
});
