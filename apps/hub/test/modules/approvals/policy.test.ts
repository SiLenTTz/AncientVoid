import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, ApprovalService, EventStore, HubDatabase, SessionManager, TokenService } from "@ancientvoid/core";
import { createAdapter as createDummy } from "@ancientvoid/adapter-dummy";
import { ProcessRunner } from "@ancientvoid/workers";
import type { FastifyInstance } from "fastify";
import { createHubApp } from "../../../src/app.ts";

/** T7.4: one policy for every route — an agent requests, a human decides. */
describe("actor policy (T7.4)", () => {
  let dir: string;
  let app: FastifyInstance;
  let sessions: SessionManager;
  let human: string;
  let agent: string;
  let display: string;
  let approvals: ApprovalService;

  async function call(method: "GET" | "POST" | "DELETE", url: string, token: string, payload?: unknown) {
    const res = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });
    return { status: res.statusCode, body: res.json() as Record<string, unknown> };
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-policy-"));
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 1, autoStopAfterEvents: 0 });
    approvals = new ApprovalService(db);
    const tokens = new TokenService(db);
    sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    sessions.enableToolPermissions({ approvals, timeoutMs: 60_000 });
    app = await createHubApp({ sessions, tokens, registry, approvals, auth: { tokens, enforceTailnetIdentity: false }, projectRoots: [dir] });
    human = tokens.issue("pixel").token;
    agent = tokens.issue("agent:mcp").token;
    display = tokens.issue("display:nyx").token;
  });

  afterEach(async () => {
    await sessions.shutdown();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("an agent's session start waits for the human, then runs exactly once", async () => {
    const asked = await call("POST", "/api/sessions", agent, { adapter: "dummy", project: dir, prompt: "Bitte starten" });
    expect(asked.status).toBe(202);
    const approvalId = asked.body.approvalId as string;
    expect(sessions.list()).toHaveLength(0);
    const queue = (await call("GET", "/api/approvals?status=pending", human)).body as unknown as { id: string; action: string; summary: string }[];
    expect(queue[0]).toMatchObject({ id: approvalId, action: "session.create" });
    expect(queue[0]!.summary).toContain("agent:mcp möchte eine Session starten: dummy");
    expect((await call("POST", `/api/approvals/${approvalId}/decide`, agent, { decision: "approve" })).status).toBe(403);
    expect((await call("POST", `/api/approvals/${approvalId}/decide`, human, { decision: "approve" })).status).toBe(200);
    expect(sessions.list()).toHaveLength(1);
    expect(sessions.operation(approvalId)).toMatchObject({ state: "done" });
  });

  it("stop: immediate for the human, a request for the agent", async () => {
    const a = await sessions.create({ adapter: "dummy", project: dir });
    const b = await sessions.create({ adapter: "dummy", project: dir });
    expect((await call("POST", `/api/sessions/${a.id}/stop`, human, {})).status).toBe(200);
    expect(sessions.get(a.id)?.status).toBe("stopped");
    const asked = await call("POST", `/api/sessions/${b.id}/stop`, agent, {});
    expect(asked.status).toBe(202);
    expect(sessions.get(b.id)?.status).not.toBe("stopped");
    await call("POST", `/api/approvals/${asked.body.approvalId}/decide`, human, { decision: "approve" });
    expect(sessions.get(b.id)?.status).toBe("stopped");
  });

  it("an agent's prompt and park are requests too; a rejected one never runs", async () => {
    const s = await sessions.create({ adapter: "dummy", project: dir });
    const prompt = await call("POST", `/api/sessions/${s.id}/steer`, agent, { kind: "prompt", text: "Mach weiter" });
    expect(prompt.status).toBe(202);
    await call("POST", `/api/approvals/${prompt.body.approvalId}/decide`, human, { decision: "reject" });
    const tail = (await sessions.tail(s.id, 0, 500)).map((e) => (e.payload as { text?: string }).text);
    expect(tail).not.toContain("Mach weiter");
    expect((await call("POST", `/api/sessions/${s.id}/steer`, agent, { kind: "park" })).status).toBe(202);
  });

  it("T8.6: rename and pin are a person's — an agent may not", async () => {
    const s = await sessions.create({ adapter: "dummy", project: dir, prompt: "Alt" });
    expect((await call("POST", `/api/sessions/${s.id}/meta`, agent, { pinned: true })).status).toBe(403);
    const ok = await call("POST", `/api/sessions/${s.id}/meta`, human, { title: "  Neu  ", pinned: true });
    expect(ok.body).toMatchObject({ title: "Neu", pinned: true });
    expect(sessions.get(s.id)).toMatchObject({ title: "Neu", pinned: true });
    expect((await call("POST", `/api/sessions/${s.id}/meta`, human, {})).status).toBe(400);
    expect((await call("POST", `/api/sessions/gibts-nicht/meta`, human, { pinned: true })).status).toBe(404);
  });

  it("an agent may read but not decide, apply, archive, manage tokens or the fleet", async () => {
    const s = await sessions.create({ adapter: "dummy", project: dir });
    expect((await call("GET", "/api/sessions", agent)).status).toBe(200);
    for (const [method, url] of [
      ["POST", `/api/sessions/${s.id}/apply`],
      ["POST", `/api/sessions/${s.id}/archive`],
      ["POST", "/api/tokens"],
      ["DELETE", "/api/tokens/pixel"],
      ["POST", "/api/fleet/invites"],
      ["POST", "/api/skills"],
    ] as const) {
      expect((await call(method, url, agent, {})).status, `${method} ${url}`).toBe(403);
    }
  });

  it("ADR-0048: a display decides a write approval, but not a destructive or reason-required one, and reaches nothing else", async () => {
    const s = await sessions.create({ adapter: "dummy", project: dir });
    expect((await call("GET", "/api/sessions", display)).status).toBe(200);
    expect((await call("GET", "/api/approvals", display)).status).toBe(200);
    for (const [method, url] of [
      ["POST", "/api/sessions"],
      ["POST", `/api/sessions/${s.id}/stop`],
      ["POST", `/api/sessions/${s.id}/steer`],
      ["POST", "/api/tokens"],
      ["GET", "/api/tokens"],
      ["GET", `/api/sessions/${s.id}/events`],
    ] as const) {
      expect((await call(method, url, display, {})).status, `${method} ${url}`).toBe(403);
    }
    const write = approvals.create(s.id, "write", "steer.prompt", "Prompt senden");
    const destructive = approvals.create(s.id, "destructive", "session.delete", "Löschen", true);
    const needsReason = approvals.create(s.id, "write", "budget.increase", "Budget erhöhen", true);
    expect((await call("POST", `/api/approvals/${destructive.id}/decide`, display, { decision: "approve" })).status).toBe(403);
    expect((await call("POST", `/api/approvals/${needsReason.id}/decide`, display, { decision: "approve" })).status).toBe(403);
    expect((await call("POST", `/api/approvals/${destructive.id}/webauthn/decide`, display, { decision: "approve" })).status).toBe(403);
    expect(approvals.get(destructive.id)?.status).toBe("pending");
    expect(approvals.get(needsReason.id)?.status).toBe("pending");
    const ok = await call("POST", `/api/approvals/${write.id}/decide`, display, { decision: "approve" });
    expect(ok.status).toBe(200);
    expect(approvals.get(write.id)).toMatchObject({ status: "approved", decidedByLabel: "display:nyx" });
  });
});
