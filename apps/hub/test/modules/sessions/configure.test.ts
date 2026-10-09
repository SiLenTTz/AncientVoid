import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { AdapterRegistry, EventStore, HubDatabase, SessionManager, TokenService } from "@uacc/core";
import { basicFeatures, type Adapter, type SteerInput } from "@uacc/contracts";
import { ProcessRunner } from "@uacc/workers";
import { createHubApp } from "../../../src/app.ts";

/** ADR-0033: POST /api/sessions/:id/steer { kind: "configure" } und der Default beim Anlegen. */
describe("hub route — Modus und Modell (ADR-0033)", () => {
  let dir: string;
  let app: FastifyInstance;
  let token: string;
  const steered: SteerInput[] = [];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "uacc-configure-route-"));
    const adapter: Adapter = {
      id: "modal",
      version: "0.0.1",
      capabilities: () => ({
        reasoning: false,
        tools: false,
        cost: false,
        steer: true,
        usage: false,
        nativeDiscovery: "none",
        nativeResume: "none",
        features: basicFeatures({ modelChoice: "start", modelSwitch: true, permissionModes: ["auto", "manual"] }),
      }),
      async start(_spec, ctx) {
        return { sessionId: ctx.sessionId };
      },
      async steer(_h, input) {
        steered.push(input);
        return { ok: true };
      },
      async status() {
        return { state: "healthy" };
      },
      async stop() {},
    };
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("modal", () => adapter);
    const sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner(), undefined, undefined, undefined, null, [], {}, undefined, "auto");
    const tokens = new TokenService(db);
    token = tokens.issue("test-device").token;
    app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false } });
  });

  afterAll(async () => {
    await app.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  });

  const call = (method: "POST" | "GET", url: string, payload?: Record<string, unknown>) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload } : {}) });

  it("a new session starts in the hub default mode, and the record says so", async () => {
    const created = await call("POST", "/api/sessions", { adapter: "modal", project: "/tmp" });
    expect(created.statusCode).toBe(201);
    expect((created.json() as { permissionMode: string }).permissionMode).toBe("auto");
  });

  it("configure changes model and mode; the new values come back from the API", async () => {
    const { id } = (await call("POST", "/api/sessions", { adapter: "modal", project: "/tmp" })).json() as { id: string };
    const ack = await call("POST", `/api/sessions/${id}/steer`, { kind: "configure", permissionMode: "manual", model: "opus" });
    expect(ack.statusCode).toBe(200);
    expect(steered.at(-1)).toEqual({ kind: "configure", permissionMode: "manual", model: "opus" });
    const record = (await call("GET", `/api/sessions/${id}`)).json() as { permissionMode: string; model: string };
    expect(record).toMatchObject({ permissionMode: "manual", model: "opus" });
  });

  it("an unknown mode is a 422 with the reason, an empty body a 400", async () => {
    const { id } = (await call("POST", "/api/sessions", { adapter: "modal", project: "/tmp" })).json() as { id: string };
    const refused = await call("POST", `/api/sessions/${id}/steer`, { kind: "configure", permissionMode: "yolo" });
    expect(refused.statusCode).toBe(422);
    expect((refused.json() as { detail: string }).detail).toBe("modal kennt den Modus „yolo“ nicht.");
    const empty = await call("POST", `/api/sessions/${id}/steer`, { kind: "configure", model: "" });
    expect(empty.statusCode).toBe(400);
  });
});
