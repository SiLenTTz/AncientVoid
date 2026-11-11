import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { AdapterRegistry, EventStore, HubDatabase, SessionManager, TokenService } from "@ancientvoid/core";
import { basicFeatures, type Adapter } from "@ancientvoid/contracts";
import { ProcessRunner } from "@ancientvoid/workers";
import { createHubApp } from "../../../src/app.ts";

/** EPIC-P15 T15.3: Vormerken und Pause über die HTTP-Routen. */
describe("hub route — Warteschlange und Pause", () => {
  let dir: string;
  let app: FastifyInstance;
  let token: string;
  const prompts: string[] = [];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-queue-route-"));
    const adapter: Adapter = {
      id: "turny",
      version: "0.0.1",
      capabilities: () => ({
        reasoning: false,
        tools: false,
        cost: false,
        steer: true,
        usage: false,
        nativeDiscovery: "none",
        nativeResume: "none",
        features: basicFeatures({ followUp: true, interrupt: true }),
      }),
      async start(_spec, ctx) {
        return { sessionId: ctx.sessionId };
      },
      async steer(_h, input) {
        if (input.kind === "prompt") prompts.push(input.text);
        return { ok: true };
      },
      async status() {
        return { state: "healthy" };
      },
      async stop() {},
    };
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("turny", () => adapter);
    const sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    const tokens = new TokenService(db);
    token = tokens.issue("test-device").token;
    app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false } });
  });

  afterAll(async () => {
    await app.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  });

  const call = (method: "POST" | "GET" | "DELETE", url: string, payload?: Record<string, unknown>) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload } : {}) });
  const create = async () => ((await call("POST", "/api/sessions", { adapter: "turny", project: "/tmp" })).json() as { id: string }).id;

  it("queue:true merkt vor, die Liste zeigt es, DELETE streicht es", async () => {
    const id = await create();
    const ack = await call("POST", `/api/sessions/${id}/steer`, { kind: "prompt", text: "später", queue: true });
    expect(ack.statusCode).toBe(200);
    expect(ack.json()).toMatchObject({ ok: true, detail: "queued" });
    expect(prompts).not.toContain("später");

    const list = (await call("GET", `/api/sessions/${id}/queue`)).json() as { id: string; text: string }[];
    expect(list).toHaveLength(1);
    expect(list[0]!.text).toBe("später");

    expect((await call("DELETE", `/api/sessions/${id}/queue/${list[0]!.id}`)).statusCode).toBe(200);
    expect((await call("DELETE", `/api/sessions/${id}/queue/${list[0]!.id}`)).statusCode).toBe(404);
    expect((await call("GET", `/api/sessions/${id}/queue`)).json()).toEqual([]);
  });

  it("eine unbekannte Session ist 404", async () => {
    expect((await call("GET", "/api/sessions/gibt-es-nicht/queue")).statusCode).toBe(404);
    expect((await call("DELETE", "/api/sessions/gibt-es-nicht/queue/x")).statusCode).toBe(404);
    expect((await call("POST", "/api/sessions/gibt-es-nicht/queue/x/send")).statusCode).toBe(404);
  });

  it("BUG-0114: POST /queue/:id/send steuert einen vorgemerkten Prompt sofort", async () => {
    const id = await create();
    await call("POST", `/api/sessions/${id}/steer`, { kind: "prompt", text: "zwischenfrage", queue: true });
    const list = (await call("GET", `/api/sessions/${id}/queue`)).json() as { id: string; text: string }[];
    expect(list).toHaveLength(1);

    const sent = await call("POST", `/api/sessions/${id}/queue/${list[0]!.id}/send`);
    expect(sent.statusCode).toBe(200);
    expect(sent.json()).toEqual({ ok: true });
    expect(prompts).toContain("zwischenfrage"); // sofort — der Zug wurde nicht beendet
    expect((await call("GET", `/api/sessions/${id}/queue`)).json()).toEqual([]);

    // weg ist weg: ein zweiter Versuch scheitert ehrlich
    const again = await call("POST", `/api/sessions/${id}/queue/${list[0]!.id}/send`);
    expect(again.statusCode).toBe(422);
    expect(again.json()).toMatchObject({ ok: false, detail: "nicht mehr in der Warteschlange" });
  });

  it("park über /steer pausiert die Session wirklich", async () => {
    const id = await create();
    const ack = await call("POST", `/api/sessions/${id}/steer`, { kind: "park" });
    expect(ack.statusCode).toBe(200);
    const record = (await call("GET", `/api/sessions/${id}`)).json() as { status: string; parkReason: string };
    expect(record).toMatchObject({ status: "parked", parkReason: "manual" });
  });
});
