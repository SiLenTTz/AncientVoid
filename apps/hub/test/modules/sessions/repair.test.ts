import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { AdapterRegistry, EventStore, HubDatabase, SessionManager, TokenService } from "@ancientvoid/core";
import { basicFeatures, type Adapter } from "@ancientvoid/contracts";
import { ProcessRunner } from "@ancientvoid/workers";
import { createHubApp } from "../../../src/app.ts";

/** BUG-0123: repair a session whose native binding went stale (agent lost
 * the provider session) — drop the binding, rebuild context from the tail. */
describe("hub route — Session reparieren", () => {
  let dir: string;
  let app: FastifyInstance;
  let token: string;
  let agentToken: string;
  const specs: { prompt?: string; args?: Record<string, unknown> }[] = [];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-repair-route-"));
    const adapter: Adapter = {
      id: "flaky",
      version: "0.0.1",
      capabilities: () => ({
        reasoning: false,
        tools: false,
        cost: false,
        steer: true,
        usage: false,
        nativeDiscovery: "none",
        nativeResume: "none",
        features: basicFeatures({ followUp: true }),
      }),
      async start(spec, ctx) {
        specs.push({ prompt: spec.prompt ?? "", ...(spec.args ? { args: spec.args as Record<string, unknown> } : {}) });
        ctx.emit({ type: "system", summary: "flaky · Session native_neu", payload: { kind: "acp.native_session", nativeSessionId: "native_neu" } });
        return { sessionId: ctx.sessionId };
      },
      async steer() {
        return { ok: true };
      },
      async status() {
        return { state: "healthy" };
      },
      async stop() {},
    };
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("flaky", () => adapter);
    const sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    const tokens = new TokenService(db);
    token = tokens.issue("test-device").token;
    agentToken = tokens.issue("agent:mcp").token;
    app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false } });
  });

  afterAll(async () => {
    await app.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  });

  const call = (method: "POST" | "GET", url: string, payload?: Record<string, unknown>) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload } : {}) });
  const postAs = (url: string, bearer: string) => app.inject({ method: "POST", url, headers: { authorization: `Bearer ${bearer}` } });

  it("repariert: tote Bindung raus, Übergabetext rein", async () => {
    expect((await call("POST", "/api/sessions/unbekannt/repair")).statusCode).toBe(404);

    const id = ((await call("POST", "/api/sessions", { adapter: "flaky", project: "/tmp", prompt: "Fenster-Drag reparieren" })).json() as { id: string }).id;
    await call("POST", `/api/sessions/${id}/stop`);

    const ack = await call("POST", `/api/sessions/${id}/repair`);
    expect(ack.statusCode).toBe(200);
    expect(ack.json()).toMatchObject({ ok: true });

    const events = ((await call("GET", `/api/sessions/${id}/events`)).json()) as { payload: { kind?: string; staleNativeId?: string } }[];
    expect(events.some((e) => e.payload.kind === "session.native_binding_dropped" && e.payload.staleNativeId === "native_neu")).toBe(true);
    expect(events.some((e) => e.payload.kind === "session.resume_without_native_id")).toBe(true);
    expect(events.some((e) => e.payload.kind === "session.continued")).toBe(true);

    const last = specs.at(-1)!;
    expect(last.args?.resumeSessionId).toBeUndefined();
    expect(last.prompt).toContain("Übergabe");
    expect(last.prompt).toContain("Fenster-Drag reparieren");

    // ein zweiter Aufruf auf der jetzt laufenden Session wird abgelehnt — kein Doppelstart
    const again = await call("POST", `/api/sessions/${id}/repair`);
    expect(again.json().ok).toBe(false);
  });

  it("Agenten-Tokens dürfen nicht reparieren (403)", async () => {
    const id = ((await call("POST", "/api/sessions", { adapter: "flaky", project: "/tmp", prompt: "zweite" })).json() as { id: string }).id;
    await call("POST", `/api/sessions/${id}/stop`);
    expect((await postAs(`/api/sessions/${id}/repair`, agentToken)).statusCode).toBe(403);
  });
});
