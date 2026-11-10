import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
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

describe("graph routes (integration, EPIC-P48)", () => {
  let base: string;
  let repo: string;
  let app: FastifyInstance;
  let token: string;

  async function buildApp(): Promise<FastifyInstance> {
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
    const built = await createHubApp({
      sessions,
      tokens,
      registry,
      auth: { tokens, enforceTailnetIdentity: false },
      store,
      projectRoots: [base],
    });
    await built.listen({ port: 0, host: "127.0.0.1" });
    return built;
  }

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), "av-graph-int-"));
    repo = join(base, "proj");
    await execAsync("git", ["init", "-q", "-b", "main", repo]);
    await execAsync("git", ["-C", repo, "config", "user.email", "t@t"]);
    await execAsync("git", ["-C", repo, "config", "user.name", "t"]);
    await mkdir(join(repo, "src"), { recursive: true });
    await writeFile(join(repo, "src", "a.ts"), "import { b } from './b'\n");
    await writeFile(join(repo, "src", "b.ts"), "export const b = 1\n");
    await writeFile(join(repo, "README.md"), "[Handbuch](src/handbuch.md)\n");
    await writeFile(join(repo, "src", "handbuch.md"), "# H\n");
    await writeFile(join(repo, "kaputt.json"), "{\n");
    await execAsync("git", ["-C", repo, "add", "."]);
    await execAsync("git", ["-C", repo, "commit", "-q", "-m", "init"]);
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await rm(base, { recursive: true, force: true });
  });

  const headers = (): { authorization: string } => ({ authorization: `Bearer ${token}` });

  it("GET /api/graph?project=: Knoten, Kanten, Gruppen, Einträge", async () => {
    const res = await app.inject({ method: "GET", url: `/api/graph?project=${encodeURIComponent(repo)}`, headers: headers() });
    expect(res.statusCode).toBe(200);
    const g = res.json();
    expect(g.scope).toBe("working-tree");
    const paths = g.nodes.map((n: { path: string }) => n.path);
    for (const p of ["README.md", "src/a.ts", "src/b.ts", "src/handbuch.md", "kaputt.json"]) expect(paths).toContain(p);
    const edges = new Set(g.edges.map((e: { from: string; to: string }) => `${e.from}→${e.to}`));
    expect(edges.has("src/a.ts→src/b.ts")).toBe(true);
    expect(edges.has("README.md→src/handbuch.md")).toBe(true);
    expect(g.nodes.find((n: { path: string }) => n.path === "README.md").group).toBe("doc");
    expect(g.nodes.find((n: { path: string }) => n.path === "kaputt.json").group).toBe("config");
  });

  it("Ziel-Schutz: fremde Pfade 422, ohne Ziel 400, unbekannte Session 404", async () => {
    const outside = await mkdtemp(join(tmpdir(), "av-graph-out-"));
    try {
      expect((await app.inject({ method: "GET", url: `/api/graph?project=${encodeURIComponent(outside)}`, headers: headers() })).statusCode).toBe(422);
      expect((await app.inject({ method: "GET", url: "/api/graph", headers: headers() })).statusCode).toBe(400);
      expect((await app.inject({ method: "GET", url: "/api/graph?session=gibtsnicht", headers: headers() })).statusCode).toBe(404);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("Session-Ziel: Graph über den Arbeitsordner der Session", async () => {
    const create = await app.inject({ method: "POST", url: "/api/sessions", headers: headers(), payload: { adapter: "dummy", project: repo } });
    expect(create.statusCode).toBe(201);
    const id = create.json().id;
    const res = await app.inject({ method: "GET", url: `/api/graph?session=${id}`, headers: headers() });
    expect(res.statusCode).toBe(200);
    const paths = res.json().nodes.map((n: { path: string }) => n.path);
    expect(paths).toContain("src/a.ts");
  });

  it("POST /api/graph/diagnose: JSON-Fehler rot, Gegenprobe grün", async () => {
    const bad = await app.inject({ method: "POST", url: `/api/graph/diagnose?project=${encodeURIComponent(repo)}`, headers: headers() });
    expect(bad.statusCode).toBe(200);
    const d = bad.json();
    expect(d.sources.find((s: { name: string }) => s.name === "JSON.parse").state).toBe("errors");
    expect(d.byFile).toEqual([{ path: "kaputt.json", errors: 1, warnings: 0 }]);
    await writeFile(join(repo, "kaputt.json"), "{}\n");
    const good = await app.inject({ method: "POST", url: `/api/graph/diagnose?project=${encodeURIComponent(repo)}`, headers: headers() });
    const g2 = good.json();
    expect(g2.sources.find((s: { name: string }) => s.name === "JSON.parse").state).toBe("ok");
    expect(g2.byFile.length).toBe(0);
  });
});
