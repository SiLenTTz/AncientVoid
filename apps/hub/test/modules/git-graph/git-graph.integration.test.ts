import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basicFeatures } from "@ancientvoid/contracts";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
import { EventStore, SessionManager, AdapterRegistry, HubDatabase, TokenService } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import { createHubApp } from "../../../src/app.ts";

const execAsync = promisify(execFile);

describe("git-graph routes (integration, ADR-0071)", () => {
  let base: string;
  let repo: string;
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), "av-gg-hub-"));
    repo = join(base, "proj");
    await execAsync("git", ["init", "-q", "-b", "main", repo]);
    await execAsync("git", ["-C", repo, "config", "user.email", "t@t.com"]);
    await execAsync("git", ["-C", repo, "config", "user.name", "T"]);
    await writeFile(join(repo, "README.md"), "# hi\n");
    await execAsync("git", ["-C", repo, "add", "."]);
    await execAsync("git", ["-C", repo, "commit", "-q", "-m", "init"]);

    const hubDir = join(base, "hub");
    const db = new HubDatabase(join(hubDir, "hub.db"));
    const store = new EventStore(join(hubDir, "sessions"));
    const registry = new AdapterRegistry();
    registry.register("dummy", () => ({
      id: "dummy",
      version: "0.0.1",
      capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: false, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures({ followUp: false, interrupt: false }) }),
      async start(_spec, ctx) {
        return { sessionId: ctx.sessionId };
      },
      async steer() {
        return { ok: true };
      },
      async recover(sessionId) {
        return { sessionId };
      },
      async status() {
        return { state: "healthy" };
      },
      async stop() {},
    }));
    const sessions = new SessionManager(db, store, registry, new ProcessRunner());
    await sessions.recoverAll();
    const tokens = new TokenService(db);
    token = tokens.issue("test-device").token;
    app = await createHubApp({
      sessions,
      tokens,
      registry,
      auth: { tokens, enforceTailnetIdentity: false },
      store,
      projectRoots: [base],
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
  });

  afterAll(async () => {
    await app.close();
    await rm(base, { recursive: true, force: true });
  });

  const headers = (): { authorization: string } => ({ authorization: `Bearer ${token}` });

  it("GET /api/git-graph?project= liefert Commits", async () => {
    const res = await app.inject({ method: "GET", url: `/api/git-graph?project=${encodeURIComponent(repo)}`, headers: headers() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { commits: { subject: string; parents: string[] }[] };
    expect(body.commits.length).toBeGreaterThanOrEqual(1);
    expect(body.commits[0]!.subject).toBe("init");
  });

  it("ohne Param → 400", async () => {
    expect((await app.inject({ method: "GET", url: "/api/git-graph", headers: headers() })).statusCode).toBe(400);
  });
});
