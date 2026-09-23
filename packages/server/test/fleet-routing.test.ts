import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import type { FastifyInstance } from "fastify";
import { AdapterRegistry, EventStore, HubDatabase, SessionManager, TokenService } from "@uacc/core";
import { ProcessRunner } from "@uacc/workers";
import { createAdapter as createDummy } from "@uacc/adapter-dummy";
import { createHubApp } from "../src/index.ts";

interface Hub {
  app: FastifyInstance;
  url: string;
  token: string;
  sessions: SessionManager;
  dir: string;
}

async function hub(hostId: string): Promise<Hub> {
  const dir = await mkdtemp(join(tmpdir(), `uacc-${hostId}-`));
  const db = new HubDatabase(":memory:");
  const registry = new AdapterRegistry();
  registry.register("dummy", createDummy, { eventsPerSecond: 20, autoStopAfterEvents: 0 });
  const sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
  const tokens = new TokenService(db);
  const token = tokens.issue("phone").token;
  const app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false }, hostId });
  await app.listen({ port: 0, host: "127.0.0.1" });
  return { app, url: `http://127.0.0.1:${(app.server.address() as { port: number }).port}`, token, sessions, dir };
}

async function call<T>(h: Hub, path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; body: T }> {
  const res = await h.app.inject({
    method: (init.method ?? (init.body === undefined ? "GET" : "POST")) as "GET",
    url: path,
    headers: { authorization: `Bearer ${h.token}` },
    ...(init.body === undefined ? {} : { payload: init.body as object }),
  });
  return { status: res.statusCode, body: res.json() as T };
}

describe("fleet routing (T6.4, ADR-0017)", () => {
  let home: Hub;
  let peer: Hub;

  beforeAll(async () => {
    home = await hub("omarchy");
    peer = await hub("silenttz-server");
    const invite = await call<{ code: string }>(peer, "/api/fleet/invites", { body: {} });
    const paired = await call(home, "/api/fleet/peers", { body: { url: peer.url, code: invite.body.code } });
    expect(paired.status).toBe(201);
  });

  afterAll(async () => {
    for (const h of [home, peer]) {
      await h.sessions.shutdown().catch(() => undefined);
      await h.app.close().catch(() => undefined);
      await rm(h.dir, { recursive: true, force: true });
    }
  });

  it("starts, reads and steers a session on exactly the addressed host", async () => {
    const created = await call<{ id: string; hostId: string }>(home, "/api/hosts/silenttz-server/sessions", { body: { adapter: "dummy", project: peer.dir } });
    expect(created.status).toBe(201);
    expect(created.body.hostId).toBe("silenttz-server");
    expect(peer.sessions.get(created.body.id)).toBeDefined();
    expect(home.sessions.get(created.body.id)).toBeUndefined();

    const one = await call<{ id: string }>(home, `/api/hosts/silenttz-server/sessions/${created.body.id}`);
    expect(one.body.id).toBe(created.body.id);

    const steer = { kind: "prompt", text: "über den Heim-Hub", inputId: "in-1", clientId: "phone" };
    expect((await call(home, `/api/hosts/silenttz-server/sessions/${created.body.id}/steer`, { body: steer })).status).toBe(200);
    expect((await call<{ detail?: string }>(home, `/api/hosts/silenttz-server/sessions/${created.body.id}/steer`, { body: steer })).body.detail).toBe(
      "duplicate input ignored",
    );
    const events = await peer.sessions.tail(created.body.id, 0);
    expect(events.filter((e) => e.type === "user")).toHaveLength(1);
  });

  it("answers for its own host id locally", async () => {
    const created = await call<{ id: string; hostId: string }>(home, "/api/hosts/omarchy/sessions", { body: { adapter: "dummy", project: home.dir } });
    expect(created.body.hostId).toBe("omarchy");
    expect(home.sessions.get(created.body.id)).toBeDefined();
  });

  it("never forwards admin paths, unknown hosts or traversal", async () => {
    expect((await call(home, "/api/hosts/silenttz-server/tokens")).status).toBe(403);
    expect((await call(home, "/api/hosts/silenttz-server/fleet/invites", { body: {} })).status).toBe(403);
    expect((await call(home, "/api/hosts/silenttz-server/sessions/../tokens")).status).toBe(403);
    expect((await call(home, "/api/hosts/nirgendwo/sessions")).status).toBe(404);
  });

  it("streams a remote session's events through the home hub", async () => {
    const created = await call<{ id: string }>(home, "/api/hosts/silenttz-server/sessions", { body: { adapter: "dummy", project: peer.dir } });
    const ws = new WebSocket(`${home.url.replace("http", "ws")}/api/hosts/silenttz-server/events/${created.body.id}/tail?token=${home.token}`);
    const seqs: number[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.on("error", reject);
      ws.on("open", () => ws.send(JSON.stringify({ type: "hello", lastSeq: 0 })));
      ws.on("message", (raw: Buffer) => {
        const msg = JSON.parse(String(raw)) as { type: string; events?: { seq: number }[] };
        for (const e of msg.events ?? []) seqs.push(e.seq);
        if (seqs.length >= 5) {
          ws.close();
          resolve();
        }
      });
      setTimeout(() => reject(new Error("no events via proxy")), 8000);
    });
    expect(seqs.slice(0, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("names an unreachable host instead of hanging", async () => {
    const other = await hub("evox2");
    const invite = await call<{ code: string }>(other, "/api/fleet/invites", { body: {} });
    await call(home, "/api/fleet/peers", { body: { url: other.url, code: invite.body.code } });
    await other.sessions.shutdown();
    await other.app.close();
    const t0 = Date.now();
    const res = await call<{ error: string; hostId: string }>(home, "/api/hosts/evox2/sessions");
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ hostId: "evox2" });
    expect(Date.now() - t0).toBeLessThan(11_000);
    await rm(other.dir, { recursive: true, force: true });
  });
});
