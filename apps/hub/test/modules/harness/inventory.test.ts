import { describe, expect, it } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore, HubDatabase, SessionManager, TokenService, AdapterRegistry, claudeDiscoverySource } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import { createHubApp } from "../../../src/app.ts";

describe("GET /api/inventory and discovery sources", () => {
  it("returns probed cells without calling a real binary, and lists a scanned transcript", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-inv-"));
    const claude = join(dir, "claude");
    const project = join(claude, "projects", "-tmp-demo");
    await mkdir(project, { recursive: true });
    await writeFile(join(project, "sess-9.jsonl"), "{}\n");
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    const sessions = new SessionManager(db, store, registry, new ProcessRunner());
    const tokens = new TokenService(db);
    const token = tokens.issue("phone").token;
    const app = await createHubApp({
      sessions,
      tokens,
      registry,
      auth: { tokens, enforceTailnetIdentity: false },
      discoverySources: [claudeDiscoverySource(claude)],
      probeRunner: {
        async run() {
          return { code: 0, output: "9.9.9\n" };
        },
      },
    });
    const headers = { authorization: `Bearer ${token}` };
    const inventory = await app.inject({ method: "GET", url: "/api/inventory", headers });
    const discovery = await app.inject({ method: "GET", url: "/api/discovery", headers });
    expect(inventory.statusCode).toBe(200);
    expect(inventory.json().items.find((item: { id: string }) => item.id === "claude")).toMatchObject({
      version: "9.9.9",
      discovery: "verified",
    });
    expect(discovery.json().items).toEqual(
      expect.arrayContaining([expect.objectContaining({ nativeSessionId: "sess-9", adapter: "claude", parentSessionId: null })]),
    );
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
});
