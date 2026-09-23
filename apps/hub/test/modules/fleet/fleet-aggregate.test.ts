import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { AdapterRegistry, EventStore, HubDatabase, SessionManager, TokenService } from "@uacc/core";
import { ProcessRunner } from "@uacc/workers";
import { createAdapter as createDummy } from "@uacc/adapter-dummy";
import { createHubApp } from "../../../src/app.ts";

interface Hub {
  app: FastifyInstance;
  url: string;
  token: string;
  tokens: TokenService;
  sessions: SessionManager;
  dir: string;
}

async function hub(hostId: string, port = 0): Promise<Hub> {
  const dir = await mkdtemp(join(tmpdir(), `uacc-${hostId}-`));
  const db = new HubDatabase(":memory:");
  const registry = new AdapterRegistry();
  registry.register("dummy", createDummy, { eventsPerSecond: 5, autoStopAfterEvents: 1 });
  const sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
  const tokens = new TokenService(db);
  const token = tokens.issue("phone").token;
  const app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false }, hostId });
  await app.listen({ port, host: "127.0.0.1" });
  return { app, url: `http://127.0.0.1:${(app.server.address() as { port: number }).port}`, token, tokens, sessions, dir };
}

async function call<T>(h: Hub, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await h.app.inject({
    method: body === undefined ? "GET" : "POST",
    url: path,
    headers: { authorization: `Bearer ${h.token}` },
    ...(body === undefined ? {} : { payload: body as object }),
  });
  return { status: res.statusCode, body: res.json() as T };
}

interface Fleet {
  self: string;
  hosts: { hostId: string; self: boolean; state: string; lastSyncAt: string | null; sessions: number }[];
  sessions: { id: string; hostId: string; project: string }[];
}

describe("fleet overview (T6.3, AC-P6-1/AC-P6-3)", () => {
  let home: Hub;
  let peer: Hub;

  beforeAll(async () => {
    home = await hub("omarchy");
    peer = await hub("silenttz-server");
    const invite = await call<{ code: string }>(peer, "/api/fleet/invites", {});
    expect((await call(home, "/api/fleet/peers", { url: peer.url, code: invite.body.code })).status).toBe(201);
  });

  afterAll(async () => {
    for (const h of [home, peer]) {
      await h.sessions.shutdown().catch(() => undefined);
      await h.app.close().catch(() => undefined);
      await rm(h.dir, { recursive: true, force: true });
    }
  });

  it("lists every host's sessions with its host id, same project names apart", async () => {
    await call(home, "/api/sessions", { adapter: "dummy", project: home.dir });
    await call(peer, "/api/sessions", { adapter: "dummy", project: peer.dir });
    await call(peer, "/api/sessions", { adapter: "dummy", project: peer.dir });
    const fleet = (await call<Fleet>(home, "/api/fleet")).body;
    expect(fleet.self).toBe("omarchy");
    expect(fleet.hosts.map((h) => [h.hostId, h.self, h.state, h.sessions])).toEqual([
      ["omarchy", true, "reachable", 1],
      ["silenttz-server", false, "reachable", 2],
    ]);
    expect(fleet.sessions.filter((s) => s.hostId === "silenttz-server")).toHaveLength(2);
    const keys = fleet.sessions.map((s) => `${s.hostId}/${s.id}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps a host's last state with its original time when it goes away", async () => {
    const before = (await call<Fleet>(home, "/api/fleet")).body.hosts.find((h) => h.hostId === "silenttz-server")!;
    await peer.app.close();
    const after = (await call<Fleet>(home, "/api/fleet")).body;
    const host = after.hosts.find((h) => h.hostId === "silenttz-server")!;
    expect(host.state).toBe("stale");
    expect(host.lastSyncAt).toBe(before.lastSyncAt);
    expect(after.sessions.filter((s) => s.hostId === "silenttz-server")).toHaveLength(2);
    expect(after.hosts.find((h) => h.self)?.state).toBe("reachable");
  });

  it("names a revoked pairing instead of pretending the host is fine", async () => {
    const other = await hub("evox2");
    try {
      const invite = await call<{ code: string }>(other, "/api/fleet/invites", {});
      await call(home, "/api/fleet/peers", { url: other.url, code: invite.body.code });
      other.tokens.revoke("fleet:omarchy");
      const fleet = (await call<Fleet>(home, "/api/fleet")).body;
      expect(fleet.hosts.find((h) => h.hostId === "evox2")?.state).toBe("unauthorized");
    } finally {
      await other.sessions.shutdown();
      await other.app.close();
      await rm(other.dir, { recursive: true, force: true });
    }
  });
});
