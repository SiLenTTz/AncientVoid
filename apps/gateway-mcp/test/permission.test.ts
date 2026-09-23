import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, ApprovalService, EventStore, HubDatabase, SessionManager, TokenService } from "@uacc/core";
import { createAdapter as createDummy } from "@uacc/adapter-dummy";
import { ProcessRunner } from "@uacc/workers";
import { createHubApp } from "@uacc/hub";
import { askHub } from "../src/permission.ts";

/** T7.2: the bridge claude starts — against a real, listening hub. */
describe("permission bridge (T7.2)", () => {
  const cleanup: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn().catch(() => undefined);
  });

  async function realHub() {
    const dir = await mkdtemp(join(tmpdir(), "uacc-bridge-"));
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 1, autoStopAfterEvents: 0 });
    const approvals = new ApprovalService(db);
    const tokens = new TokenService(db);
    const sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    sessions.enableToolPermissions({ approvals, timeoutMs: 60_000 });
    const app = await createHubApp({ sessions, tokens, registry, approvals, auth: { tokens, enforceTailnetIdentity: false } });
    await app.listen({ port: 0, host: "127.0.0.1" });
    cleanup.push(async () => {
      await sessions.shutdown();
      await app.close();
      await rm(dir, { recursive: true, force: true });
    });
    const { id } = await sessions.create({ adapter: "dummy", project: dir });
    return {
      url: `http://127.0.0.1:${(app.server.address() as { port: number }).port}`,
      sessionId: id,
      bridgeToken: tokens.issue(`bridge:${id}`).token,
      approvals,
      device: tokens.issue("pixel").token,
    };
  }

  it("waits for the phone and returns claude's answer shape", async () => {
    const hub = await realHub();
    const answer = askHub(
      { hubUrl: hub.url, token: hub.bridgeToken, sessionId: hub.sessionId, retryMs: 50 },
      { tool_name: "Bash", input: { command: "echo hallo" }, tool_use_id: "toolu_x" },
    );
    let pending: { id: string } | undefined;
    for (let i = 0; i < 100 && !pending; i++) {
      pending = hub.approvals.list("pending")[0];
      if (!pending) await new Promise((r) => setTimeout(r, 20));
    }
    hub.approvals.decide(pending!.id, "approve", hub.device, "pixel");
    expect(await answer).toEqual({ behavior: "allow", updatedInput: { command: "echo hallo" } });
  });

  it("a hub that is not reachable yet costs retries, not the answer", async () => {
    // Reserve a port, then start the hub on it only after the bridge began asking.
    const probe: Server = createServer();
    await new Promise<void>((r) => probe.listen(0, "127.0.0.1", () => r()));
    const port = (probe.address() as { port: number }).port;
    await new Promise((r) => probe.close(r));
    const hub = await realHub();
    const forward = createServer((req, res) => {
      const target = new URL(req.url ?? "/", hub.url);
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", async () => {
        const upstream = await fetch(target, { method: req.method ?? "GET", headers: req.headers as Record<string, string>, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
        res.writeHead(upstream.status, { "content-type": "application/json" });
        res.end(await upstream.text());
      });
    });
    const answer = askHub({ hubUrl: `http://127.0.0.1:${port}`, token: hub.bridgeToken, sessionId: hub.sessionId, retryMs: 50 }, { tool_name: "Bash", input: { command: "ls" } });
    await new Promise((r) => setTimeout(r, 200)); // bridge is retrying against a closed port
    await new Promise<void>((r) => forward.listen(port, "127.0.0.1", () => r()));
    cleanup.push(() => new Promise((r) => forward.close(() => r())));
    let pending: { id: string } | undefined;
    for (let i = 0; i < 200 && !pending; i++) {
      pending = hub.approvals.list("pending")[0];
      if (!pending) await new Promise((r) => setTimeout(r, 20));
    }
    hub.approvals.decide(pending!.id, "reject", hub.device, "pixel", "nein");
    expect(await answer).toEqual({ behavior: "deny", message: "Abgelehnt von pixel: nein. Nicht ausführen." });
  });

  it("a request the hub refuses is denied, never allowed", async () => {
    const hub = await realHub();
    const answer = await askHub({ hubUrl: hub.url, token: hub.bridgeToken, sessionId: "not-this-session", retryMs: 10 }, { tool_name: "Bash", input: {} });
    expect(answer.behavior).toBe("deny");
  });
});
