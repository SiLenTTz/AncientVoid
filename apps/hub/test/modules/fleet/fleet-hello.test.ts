import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { FLEET_PROTOCOL_VERSION } from "@ancientvoid/contracts";
import { AdapterRegistry, EventStore, HubDatabase, SessionManager, TokenService } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import { createAdapter as createDummy } from "@ancientvoid/adapter-dummy";
import { createHubApp } from "../../../src/app.ts";

describe("fleet identity (T6.1, ADR-0017)", () => {
  let dir: string;
  let app: FastifyInstance;
  let sessions: SessionManager;
  let token = "";

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-fleet-"));
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 5, autoStopAfterEvents: 1 });
    sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    const tokens = new TokenService(db);
    token = tokens.issue("t").token;
    app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false }, hostId: "workstation" });
  });

  afterAll(async () => {
    await sessions.shutdown();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("answers hello without a token: host id and protocol version", async () => {
    const res = await app.inject({ method: "GET", url: "/api/fleet/hello" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ hostId: "workstation", protocolVersion: FLEET_PROTOCOL_VERSION });
  });

  it("stamps every session with the hub's host id", async () => {
    const auth = { authorization: `Bearer ${token}` };
    const created = await app.inject({ method: "POST", url: "/api/sessions", headers: auth, payload: { adapter: "dummy", project: dir } });
    const id = (created.json() as { id: string }).id;
    const one = await app.inject({ method: "GET", url: `/api/sessions/${id}`, headers: auth });
    expect(one.json()).toMatchObject({ hostId: "workstation" });
    const list = await app.inject({ method: "GET", url: "/api/sessions", headers: auth });
    expect((list.json() as { hostId: string }[]).every((s) => s.hostId === "workstation")).toBe(true);
  });
});
