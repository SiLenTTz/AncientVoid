import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { EventStore, SessionManager, AdapterRegistry, HubDatabase, TokenService } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import { createHubApp } from "../../src/app.ts";
import { operationOf } from "../../src/platform/policy.ts";

/**
 * BUG-0110: prompt-enhance/-recommendation/-optimizer-feedback were mapped
 * to `read`, so an agent token could fire paid one-shot CLI runs and append
 * to the learning JSONL without approval — the policy table's whole point
 * per T7.4. They get their own operation now; agents are denied.
 */
describe("policy: prompt cost loop (BUG-0110)", () => {
  it("the three endpoints map to their own operation, not to read", () => {
    for (const path of ["/api/prompt-enhance", "/api/prompt-recommendation", "/api/prompt-optimizer/feedback"]) {
      expect(operationOf("POST", path, {}), path).toBe("prompt.enhance");
    }
  });

  let dir: string;
  let app: FastifyInstance;
  let agentToken: string;
  let humanToken: string;
  const feedback = { adapter: "dummy", project: "/tmp", original: "audit", enhanced: "audit", decision: "accepted", latencyMs: 1 };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-prompt-cost-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const sessions = new SessionManager(db, store, new AdapterRegistry(), new ProcessRunner());
    const tokens = new TokenService(db);
    agentToken = tokens.issue("agent:audit").token;
    humanToken = tokens.issue("test-device").token;
    app = await createHubApp({ sessions, tokens, registry: new AdapterRegistry(), auth: { tokens, enforceTailnetIdentity: false }, store, dataDir: dir });
    await app.listen({ port: 0, host: "127.0.0.1" });
  });

  afterAll(async () => {
    await app.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  });

  it("an agent token is denied the learning write instead of appending JSONL", async () => {
    const res = await app.inject({ method: "POST", url: "/api/prompt-optimizer/feedback", headers: { authorization: `Bearer ${agentToken}` }, payload: feedback });
    expect(res.statusCode).toBe(403);
  });

  it("the human path still works (guard against over-blocking)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/prompt-optimizer/feedback", headers: { authorization: `Bearer ${humanToken}` }, payload: feedback });
    expect(res.statusCode).toBe(200);
  });
});
