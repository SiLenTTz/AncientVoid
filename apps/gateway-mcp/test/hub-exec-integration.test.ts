import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { EventStore, SessionManager, AdapterRegistry, HubDatabase, TokenService, ApprovalService } from "@uacc/core";
import { ProcessRunner } from "@uacc/workers";
import { createAdapter as createDummy } from "@uacc/adapter-dummy";
import { createHubApp } from "@uacc/hub";
import { buildGatewayServer } from "../src/server.ts";

/**
 * T4.6: hub_exec against a REAL running hub (real HTTP, real
 * SessionManager, real ApprovalService when configured), driven through a
 * REAL MCP client (Client + InMemoryTransport, the same public API a real
 * MCP-speaking agent would use) — not a mocked fetch, not a reach into
 * McpServer internals. Proves the gateway is exactly as privileged as any
 * other authenticated device, no more: a write-class operation against an
 * approval-gated hub comes back "pending approval" through the gateway
 * exactly like it would through hubctl or the PWA, never bypassed.
 */
describe("gateway-mcp hub_exec — real hub, real HTTP, real MCP client", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let token: string;
  let dir: string;
  let sessions: SessionManager;
  let client: Client;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "uacc-gw-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, {});
    const approvals = new ApprovalService(db, 60_000);
    sessions = new SessionManager(db, store, registry, new ProcessRunner(), undefined, undefined, approvals);
    const tokens = new TokenService(db);
    token = tokens.issue("gateway-test").token;
    app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false }, approvals });
    await app.listen({ port: 0, host: "127.0.0.1" });
    baseUrl = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;

    const server = buildGatewayServer({ baseUrl, token });
    client = new Client({ name: "test-client", version: "0.0.1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterAll(async () => {
    await client.close().catch(() => undefined);
    await app.close().catch(() => undefined);
    await sessions.shutdown().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  });

  function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
    const content = result.content as { type: string; text: string }[];
    return content[0]!.text;
  }

  it("hub_search finds a real operation by keyword", async () => {
    const result = await client.callTool({ name: "hub_search", arguments: { query: "diff" } });
    const matches = JSON.parse(textOf(result));
    expect(matches.some((m: { id: string }) => m.id === "sessions.diff")).toBe(true);
  });

  it("hub_describe returns a real JSON schema for a found operation", async () => {
    const result = await client.callTool({ name: "hub_describe", arguments: { op: "sessions.steer_prompt" } });
    const described = JSON.parse(textOf(result));
    expect(described.class).toBe("write");
    expect(described.argsSchema.required).toContain("sessionId");
    expect(described.argsSchema.required).toContain("text");
  });

  it("hub_exec really lists a real, freshly created session — a genuine round trip against the real hub", async () => {
    // No create op is exposed through the gateway (see operations.ts's
    // own doc comment for why) — create directly, then use hub_exec for
    // the real read operation.
    const record = await sessions.create({ adapter: "dummy", project: dir });

    const result = await client.callTool({ name: "hub_exec", arguments: { op: "sessions.list", args_json: "{}" } });
    const list = JSON.parse(textOf(result));
    expect(list.some((s: { id: string }) => s.id === record.id)).toBe(true);
  });

  it("hub_exec on a write-class operation returns the real 'pending approval' response — never bypasses ADR-0007's gate", async () => {
    const record = await sessions.create({ adapter: "dummy", project: dir });

    const result = await client.callTool({
      name: "hub_exec",
      arguments: { op: "sessions.steer_prompt", args_json: JSON.stringify({ sessionId: record.id, text: "refactor everything" }) },
    });
    const body = JSON.parse(textOf(result)) as { ok: boolean; detail?: string };
    expect(body.ok).toBe(false);
    expect(body.detail).toMatch(/pending approval/);

    const pending = await client.callTool({
      name: "hub_exec",
      arguments: { op: "approvals.list", args_json: JSON.stringify({ status: "pending" }) },
    });
    const approvalsList = JSON.parse(textOf(pending));
    expect(approvalsList.some((a: { action: string }) => a.action === "steer.prompt")).toBe(true);
  });

  it("hub_exec rejects invalid arguments before ever reaching the hub", async () => {
    const result = await client.callTool({ name: "hub_exec", arguments: { op: "sessions.get", args_json: "{}" } });
    expect(result.isError).toBe(true);
    expect(JSON.parse(textOf(result)).error).toBe("argument validation failed");
  });

  it("hub_exec on an unknown operation is a named error, not a crash", async () => {
    const result = await client.callTool({ name: "hub_exec", arguments: { op: "does.not.exist", args_json: "{}" } });
    expect(result.isError).toBe(true);
    expect(JSON.parse(textOf(result)).error).toMatch(/unknown operation/);
  });
});
