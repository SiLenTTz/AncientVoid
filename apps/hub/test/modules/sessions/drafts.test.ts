import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, EventStore, HubDatabase, SessionManager, TokenService } from "@ancientvoid/core";
import { createAdapter as createDummy } from "@ancientvoid/adapter-dummy";
import { ProcessRunner } from "@ancientvoid/workers";
import type { FastifyInstance } from "fastify";
import { createHubApp } from "../../../src/app.ts";

/** T8.4 (ADR-0025): one draft per session, shared, never silently overwritten. */
describe("drafts (T8.4)", () => {
  let dir: string;
  let app: FastifyInstance;
  let sessions: SessionManager;
  let phone: string;
  let pc: string;
  let agent: string;

  async function call(method: "GET" | "PUT", url: string, token: string, payload?: unknown) {
    const res = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });
    return { status: res.statusCode, body: res.json() as Record<string, unknown> };
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-drafts-"));
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 1, autoStopAfterEvents: 0 });
    const tokens = new TokenService(db);
    sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false }, projectRoots: [dir] });
    phone = tokens.issue("pixel").token;
    pc = tokens.issue("desktop").token;
    agent = tokens.issue("agent:mcp").token;
  });

  afterEach(async () => {
    await sessions.shutdown();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("the phone's draft shows on the PC; a stale edit is a conflict, not an overwrite", async () => {
    const s = await sessions.create({ adapter: "dummy", project: dir });
    const url = `/api/sessions/${s.id}/draft`;
    expect((await call("GET", url, pc)).body).toMatchObject({ text: "", revision: 0 });
    const first = await call("PUT", url, phone, { text: "Bitte die Tests", baseRevision: 0 });
    expect(first.body).toMatchObject({ text: "Bitte die Tests", revision: 1, device: "pixel" });
    expect((await call("GET", url, pc)).body).toMatchObject({ text: "Bitte die Tests", revision: 1 });
    const pcEdit = await call("PUT", url, pc, { text: "Bitte die Tests reparieren", baseRevision: 1 });
    expect(pcEdit.body).toMatchObject({ revision: 2, device: "desktop" });
    // The phone still thinks revision 1.
    const stale = await call("PUT", url, phone, { text: "Bitte die Tests löschen", baseRevision: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.current).toMatchObject({ text: "Bitte die Tests reparieren", revision: 2 });
    // Same text from a stale device is no conflict.
    expect((await call("PUT", url, phone, { text: "Bitte die Tests reparieren", baseRevision: 1 })).status).toBe(200);
    // Sent → emptied; the revision keeps counting.
    expect((await call("PUT", url, pc, { text: "", baseRevision: 2 })).body).toMatchObject({ text: "", revision: 3 });
  });

  it("agents neither read nor write a person's draft", async () => {
    const s = await sessions.create({ adapter: "dummy", project: dir });
    expect((await call("GET", `/api/sessions/${s.id}/draft`, agent)).status).toBe(403);
    expect((await call("PUT", `/api/sessions/${s.id}/draft`, agent, { text: "x", baseRevision: 0 })).status).toBe(403);
    expect((await call("PUT", `/api/sessions/nope/draft`, phone, { text: "x", baseRevision: 0 })).status).toBe(404);
    expect((await call("PUT", `/api/sessions/${s.id}/draft`, phone, { text: "x" })).status).toBe(400);
  });
});
