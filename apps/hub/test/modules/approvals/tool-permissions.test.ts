import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, ApprovalService, EventStore, HubDatabase, SessionManager, TokenService } from "@uacc/core";
import { createAdapter as createDummy } from "@uacc/adapter-dummy";
import { ProcessRunner } from "@uacc/workers";
import type { FastifyInstance } from "fastify";
import { createHubApp } from "../../../src/app.ts";
import { createPermissionBridge } from "../../../src/modules/approvals/permission-bridge.ts";

/**
 * T7.2 / ADR-0018 §3: a provider asks through the bridge, the phone decides.
 * The bridge's token may ask and wait for its own session — never decide,
 * never read anything else (an agent must not release its own tools).
 */
describe("native tool permissions (T7.2)", () => {
  let dir: string;
  let app: FastifyInstance;
  let sessions: SessionManager;
  let tokens: TokenService;
  let device: string;
  let bridgeToken: string;
  let sessionId: string;

  async function call(method: "GET" | "POST", url: string, token: string, payload?: unknown) {
    const res = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });
    return { status: res.statusCode, body: res.json() as Record<string, unknown> };
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "uacc-tools-"));
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 1, autoStopAfterEvents: 0 });
    const approvals = new ApprovalService(db);
    tokens = new TokenService(db);
    sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    const bridge = createPermissionBridge({ tokens, hubUrl: "http://127.0.0.1:1", dir: join(dir, "bridges") });
    sessions.enableToolPermissions({ approvals, timeoutMs: 60_000, bridge });
    app = await createHubApp({ sessions, tokens, registry, approvals, auth: { tokens, enforceTailnetIdentity: false } });
    device = tokens.issue("pixel").token;
    sessionId = (await sessions.create({ adapter: "dummy", project: dir })).id;
    // What the hub writes for claude: an MCP config (0600) with a session-bound token.
    const { mcpConfigPath } = await bridge(sessionId);
    expect((await stat(mcpConfigPath)).mode & 0o777).toBe(0o600);
    const config = JSON.parse(await readFile(mcpConfigPath, "utf8")) as { mcpServers: { uacc: { env: Record<string, string> } } };
    bridgeToken = config.mcpServers.uacc.env.UACC_BRIDGE_TOKEN!;
    expect(config.mcpServers.uacc.env.UACC_SESSION_ID).toBe(sessionId);
  });

  afterEach(async () => {
    await sessions.shutdown();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("asks, waits, and hands back exactly the approved input; the session waits meanwhile", async () => {
    const input = { command: "npm test", description: "Tests laufen lassen" };
    const asked = await call("POST", `/api/sessions/${sessionId}/tool-permissions`, bridgeToken, { toolName: "Bash", input, toolUseId: "toolu_1" });
    expect(asked.status).toBe(201);
    const id = asked.body.id as string;
    // a bridge that retried after a hub restart gets the same request
    expect((await call("POST", `/api/sessions/${sessionId}/tool-permissions`, bridgeToken, { toolName: "Bash", input, toolUseId: "toolu_1" })).body.id).toBe(id);
    expect(sessions.get(sessionId)?.status).toBe("waiting_approval");
    expect((await call("GET", `/api/sessions/${sessionId}/tool-permissions/${id}`, bridgeToken)).body).toEqual({ state: "pending", id });

    const listed = (await call("GET", "/api/approvals?status=pending", device)).body as unknown as { id: string; summary: string; tool: { name: string } }[];
    expect(listed[0]).toMatchObject({ id, summary: "Bash: npm test", tool: { name: "Bash" } });

    expect((await call("POST", `/api/approvals/${id}/decide`, device, { decision: "approve" })).status).toBe(200);
    const answered = await call("GET", `/api/sessions/${sessionId}/tool-permissions/${id}?waitMs=1000`, bridgeToken);
    expect(answered.body).toEqual({ state: "answered", id, answer: { behavior: "allow", updatedInput: input } });
    expect(sessions.get(sessionId)?.status).toBe("working");
  });

  it("the bridge token can neither decide nor read anything else", async () => {
    const asked = await call("POST", `/api/sessions/${sessionId}/tool-permissions`, bridgeToken, { toolName: "Bash", input: { command: "rm -rf /" } });
    const id = asked.body.id as string;
    expect((await call("POST", `/api/approvals/${id}/decide`, bridgeToken, { decision: "approve" })).status).toBe(403);
    expect((await call("GET", "/api/sessions", bridgeToken)).status).toBe(403);
    expect((await call("GET", "/api/approvals", bridgeToken)).status).toBe(403);
    const other = (await sessions.create({ adapter: "dummy", project: dir })).id;
    expect((await call("POST", `/api/sessions/${other}/tool-permissions`, bridgeToken, { toolName: "Bash", input: {} })).status).toBe(403);
    expect((await call("GET", `/api/sessions/${sessionId}/tool-permissions/${id}`, bridgeToken)).body.state).toBe("pending");
  });

  it("a rejection answers deny with who and why — the provider must not run it", async () => {
    const id = (await call("POST", `/api/sessions/${sessionId}/tool-permissions`, bridgeToken, { toolName: "Bash", input: { command: "git push --force" } })).body.id as string;
    await call("POST", `/api/approvals/${id}/decide`, device, { decision: "reject", reason: "kein Force-Push" });
    const answered = await call("GET", `/api/sessions/${sessionId}/tool-permissions/${id}`, bridgeToken);
    expect(answered.body.answer).toEqual({ behavior: "deny", message: "Abgelehnt von pixel: kein Force-Push. Nicht ausführen." });
    expect(sessions.operation(id)?.state).toBe("rejected");
  });

  it("a provider question needs an answer, which goes back with the input", async () => {
    const questions = [{ question: "Welche Farbe?", header: "Farbe", options: [{ label: "Rot" }, { label: "Grün" }], multiSelect: false }];
    const id = (await call("POST", `/api/sessions/${sessionId}/tool-permissions`, bridgeToken, { toolName: "AskUserQuestion", input: { questions } })).body.id as string;
    const listed = (await call("GET", "/api/approvals?status=pending", device)).body as unknown as { action: string; tool: { questions: unknown[] } }[];
    expect(listed[0]).toMatchObject({ action: "tool.question", tool: { questions } });
    expect((await call("POST", `/api/approvals/${id}/decide`, device, { decision: "approve" })).body).toEqual({ ok: false, detail: "Antwort fehlt." });
    expect((await call("POST", `/api/approvals/${id}/decide`, device, { decision: "approve", answers: { "Welche Farbe?": "Grün" } })).status).toBe(200);
    const answered = await call("GET", `/api/sessions/${sessionId}/tool-permissions/${id}`, bridgeToken);
    expect(answered.body.answer).toEqual({ behavior: "allow", updatedInput: { questions, answers: { "Welche Farbe?": "Grün" } } });
  });
});

describe("tool permission timeout (T7.2)", () => {
  it("no decision in time answers deny — never allow", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uacc-tools-timeout-"));
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 1, autoStopAfterEvents: 0 });
    const sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    sessions.enableToolPermissions({ approvals: new ApprovalService(db), timeoutMs: 50 });
    try {
      const { id: sessionId } = await sessions.create({ adapter: "dummy", project: dir });
      const asked = await sessions.requestToolPermission(sessionId, { toolName: "Bash", input: { command: "ls" } });
      if (!asked.ok) throw new Error(asked.detail);
      await new Promise((r) => setTimeout(r, 120));
      const poll = await sessions.pollToolPermission(sessionId, asked.id);
      expect(poll).toEqual({ state: "answered", id: asked.id, answer: { behavior: "deny", message: "Keine Freigabe innerhalb von 1 s — nicht ausgeführt." } });
    } finally {
      await sessions.shutdown();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
