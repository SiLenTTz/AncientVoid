import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { WebSocket } from "ws";
import { EventStore, SessionManager, AdapterRegistry, HubDatabase, TokenService } from "@uacc/core";
import { ProcessRunner } from "@uacc/workers";
import { createAdapter as createDummy } from "@uacc/adapter-dummy";
import { createHubApp } from "../src/index.ts";

describe("hub server", () => {
  let dir: string;
  let app: FastifyInstance;
  let token: string;
  let baseUrl: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "uacc-srv-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 10, autoStopAfterEvents: 25 });
    const sessions = new SessionManager(db, store, registry, new ProcessRunner());
    const tokens = new TokenService(db);
    token = tokens.issue("test-device").token;
    app = await createHubApp({
      sessions,
      tokens,
      registry,
      auth: { tokens, enforceTailnetIdentity: false },
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    baseUrl = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await app.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  });

  it("health stays open without auth (tailnet monitoring)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("rejects requests without device token (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sessions" });
    expect(res.statusCode).toBe(401);
  });

  it("BUG-0006: does not gate non-/api/ paths behind a token", async () => {
    // The PWA shell (index.html, its JS/CSS bundle, manifest, sw.js) must
    // be reachable without a token — a real browser never carries a
    // URL's ?token= onto the <script>/<link> requests the document
    // triggers, so gating the shell itself made TokenGate unreachable on
    // a fresh device. No pwaDir is configured in this test app, so the
    // request 404s past Fastify's default handler — the point here is
    // that it's NOT 401, proving the auth hook let it through.
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).not.toBe(401);
  });

  it("still gates every /api/ path, including ones added after auth.ts's exemption list", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sessions/does-not-exist/events" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects invalid tokens (401)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/sessions",
      headers: { authorization: "Bearer wrong" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("accepts valid device tokens", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/sessions",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("ADR-0004: GET /api/adapters/:id/usage reports supported+no-snapshot honestly for an adapter without usage", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/adapters/dummy/usage",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    // dummy: capabilities().usage === false — never guessed as 0% or omitted.
    expect(res.json()).toEqual({ adapterId: "dummy", supported: false, quota: null, observedAt: null });
  });

  it("GET /api/adapters/:id/usage 404s for an unregistered adapter id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/adapters/does-not-exist/usage",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("creates a session via POST /api/sessions", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { authorization: `Bearer ${token}` },
      payload: { adapter: "dummy", project: dir },
    });
    expect(res.statusCode).toBe(201);
    const record = res.json() as { id: string; status: string };
    expect(record.status).toBe("working");
  });

  it("rejects invalid session specs (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { authorization: `Bearer ${token}` },
      payload: { adapter: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("enforces tailnet identity when configured", async () => {
    const db = new HubDatabase(":memory:");
    const tokens = new TokenService(db);
    const t = tokens.issue("tailnet-test").token;
    const strictApp = await createHubApp({
      sessions: new SessionManager(
        db,
        new EventStore(join(dir, "strict")),
        new AdapterRegistry(),
        new ProcessRunner(),
      ),
      tokens,
      registry: new AdapterRegistry(),
      auth: { tokens, enforceTailnetIdentity: true },
    });
    const noHeader = await strictApp.inject({
      method: "GET",
      url: "/api/sessions",
      headers: { authorization: `Bearer ${t}` },
    });
    expect(noHeader.statusCode).toBe(401);
    const withHeader = await strictApp.inject({
      method: "GET",
      url: "/api/sessions",
      headers: { authorization: `Bearer ${t}`, "tailscale-user-login": "jan@tailnet" },
    });
    expect(withHeader.statusCode).toBe(200);
    await strictApp.close();
  });

  it("WS tail: hello → events flow with gapless seq deltas", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { authorization: `Bearer ${token}` },
      payload: { adapter: "dummy", project: dir },
    });
    const { id } = created.json() as { id: string };
    const wsUrl = baseUrl.replace("http", "ws");
    const ws = new WebSocket(`${wsUrl}/api/events/${id}/tail?token=${token}`);
    const received: { type: string; events?: { seq: number }[]; highWater?: number }[] = [];
    const done = new Promise<void>((resolve, reject) => {
      ws.on("error", reject);
      ws.on("message", (raw: Buffer) => {
        const msg = JSON.parse(String(raw)) as { type: string; events?: { seq: number }[] };
        received.push(msg);
        if (received.filter((m) => m.type === "events" && (m.events?.length ?? 0) > 0).length >= 2) {
          ws.close();
          resolve();
        }
      });
      ws.on("open", () => ws.send(JSON.stringify({ type: "hello", lastSeq: 0 })));
      setTimeout(() => reject(new Error("ws timeout")), 8000);
    });
    await done;

    const eventBatches = received.filter((m) => m.type === "events");
    let prev = 0;
    for (const batch of eventBatches) {
      for (const e of batch.events ?? []) {
        expect(e.seq).toBe(prev + 1);
        prev = e.seq;
      }
    }
    expect(prev).toBeGreaterThan(2);
  });

  it("WS resync: client-requested replay from store fills gaps", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { authorization: `Bearer ${token}` },
      payload: { adapter: "dummy", project: dir },
    });
    const { id } = created.json() as { id: string };
    await new Promise((r) => setTimeout(r, 400));
    const wsUrl = baseUrl.replace("http", "ws");
    const ws = new WebSocket(`${wsUrl}/api/events/${id}/tail?token=${token}`);
    const resynced = new Promise<void>((resolve, reject) => {
      ws.on("error", reject);
      ws.on("message", (raw: Buffer) => {
        const msg = JSON.parse(String(raw)) as { type: string; events?: { seq: number }[] };
        if (msg.type === "events" && (msg.events?.length ?? 0) > 3) {
          const seqs = (msg.events ?? []).map((e) => e.seq);
          expect(seqs[0]).toBe(1); // resync from 0 replays from the first event
          ws.close();
          resolve();
        }
      });
      ws.on("open", () => ws.send(JSON.stringify({ type: "resync", since: 0 })));
      setTimeout(() => reject(new Error("ws resync timeout")), 8000);
    });
    await resynced;
  });

  it("404s GET /api/sessions/:id/diff for an unknown session", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/sessions/nope/diff",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /api/sessions/:id/diff returns a real diff for a session in a real git repo (T1.6-4/5)", async () => {
    const { mkdtemp: mkdtempFs, writeFile } = await import("node:fs/promises");
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const repo = await mkdtempFs(join(tmpdir(), "uacc-diff-repo-"));
    await execFileAsync("git", ["init", "-q", repo]);
    await execFileAsync("git", ["-C", repo, "config", "user.email", "test@example.com"]);
    await execFileAsync("git", ["-C", repo, "config", "user.name", "Test"]);
    await writeFile(join(repo, "a.txt"), "one\n");
    await execFileAsync("git", ["-C", repo, "add", "a.txt"]);
    await execFileAsync("git", ["-C", repo, "commit", "-q", "-m", "init"]);
    await writeFile(join(repo, "a.txt"), "one\ntwo\n");

    const created = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { authorization: `Bearer ${token}` },
      payload: { adapter: "dummy", project: repo },
    });
    const { id } = created.json() as { id: string };
    const res = await app.inject({
      method: "GET",
      url: `/api/sessions/${id}/diff`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { files: { path: string; additions: number }[]; patch: string };
    expect(body.files).toEqual([{ path: "a.txt", additions: 1, deletions: 0, binary: false }]);
    expect(body.patch).toContain("+two");
    await rm(repo, { recursive: true, force: true });
  });
});

describe("hub server — pwaDir resolution (BUG-0009)", () => {
  async function buildApp(pwaDir?: string) {
    const dir = await mkdtemp(join(tmpdir(), "uacc-srv-pwa-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, {});
    const sessions = new SessionManager(db, store, registry, new ProcessRunner());
    const tokens = new TokenService(db);
    const app = await createHubApp({
      sessions,
      tokens,
      registry,
      auth: { tokens, enforceTailnetIdentity: false },
      ...(pwaDir ? { pwaDir } : {}),
    });
    return { app, cleanup: () => rm(dir, { recursive: true, force: true }) };
  }

  it("a pwaDir that doesn't resolve to an existing directory doesn't crash the app and still serves /api/*", async () => {
    // Found via a real end-to-end run: the shipped hub.config.example.json
    // had a pwaDir that resolved outside the repo when the README's own
    // Quick Start was followed literally (cp to repo root, run from repo
    // root) — this used to fail with zero log output, just a bare 404 on
    // every non-/api/ request with no clue why.
    const { app, cleanup } = await buildApp("./this-directory-does-not-exist");
    try {
      const health = await app.inject({ method: "GET", url: "/api/health" });
      expect(health.statusCode).toBe(200);
      const root = await app.inject({ method: "GET", url: "/" });
      expect(root.statusCode).toBe(404);
    } finally {
      await app.close().catch(() => undefined);
      await cleanup();
    }
  });

  it("a valid pwaDir serves the SPA shell for non-/api/ routes", async () => {
    const pwaDir = await mkdtemp(join(tmpdir(), "uacc-pwa-dist-"));
    await import("node:fs/promises").then((fs) => fs.writeFile(join(pwaDir, "index.html"), "<!doctype html><title>uacc</title>"));
    const { app, cleanup } = await buildApp(pwaDir);
    try {
      const root = await app.inject({ method: "GET", url: "/" });
      expect(root.statusCode).toBe(200);
      expect(root.body).toContain("uacc");
      // SPA fallback: any non-/api/ path (client-side routing) serves the
      // same shell, not a 404.
      const spaRoute = await app.inject({ method: "GET", url: "/some/client/route" });
      expect(spaRoute.statusCode).toBe(200);
      expect(spaRoute.body).toContain("uacc");
    } finally {
      await app.close().catch(() => undefined);
      await cleanup();
      await rm(pwaDir, { recursive: true, force: true });
    }
  });
});

describe("hub server — project auto-discovery (T1.5-4, AC-P1.5-4/5)", () => {
  async function buildApp(projectRoots: string[]) {
    const dir = await mkdtemp(join(tmpdir(), "uacc-srv-projects-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, {});
    const sessions = new SessionManager(db, store, registry, new ProcessRunner());
    const tokens = new TokenService(db);
    const token = tokens.issue("test-device").token;
    const app = await createHubApp({
      sessions,
      tokens,
      registry,
      auth: { tokens, enforceTailnetIdentity: false },
      projectRoots,
    });
    return { app, token, cleanup: () => rm(dir, { recursive: true, force: true }) };
  }

  it("GET /api/projects lists real repos under a configured root", async () => {
    const root = await mkdtemp(join(tmpdir(), "uacc-projects-root-"));
    const repo = join(root, "mobile-hub");
    await import("node:fs/promises").then((fs) => fs.mkdir(join(repo, ".git"), { recursive: true }));
    const { app, token, cleanup } = await buildApp([root]);
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/projects",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { projects: { name: string; path: string }[]; warnings: string[] };
      expect(body.warnings).toEqual([]);
      expect(body.projects.map((p) => p.name)).toEqual(["mobile-hub"]);
      expect(body.projects[0]!.path).toBe(repo);
    } finally {
      await app.close().catch(() => undefined);
      await cleanup();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("POST /api/sessions rejects a project path outside the configured roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "uacc-projects-root-"));
    const outside = await mkdtemp(join(tmpdir(), "uacc-projects-outside-"));
    const { app, token, cleanup } = await buildApp([root]);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/sessions",
        headers: { authorization: `Bearer ${token}` },
        payload: { adapter: "dummy", project: outside },
      });
      expect(res.statusCode).toBe(422);
    } finally {
      await app.close().catch(() => undefined);
      await cleanup();
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("POST /api/sessions accepts a project path inside a configured root", async () => {
    const root = await mkdtemp(join(tmpdir(), "uacc-projects-root-"));
    const repo = join(root, "mobile-hub");
    await import("node:fs/promises").then((fs) => fs.mkdir(repo, { recursive: true }));
    const { app, token, cleanup } = await buildApp([root]);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/sessions",
        headers: { authorization: `Bearer ${token}` },
        payload: { adapter: "dummy", project: repo },
      });
      expect(res.statusCode).toBe(201);
    } finally {
      await app.close().catch(() => undefined);
      await cleanup();
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("hub server — POST /api/prompt-enhance (T1.5-8)", () => {
  async function buildApp(projectRoots: string[]) {
    const dir = await mkdtemp(join(tmpdir(), "uacc-srv-enhance-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, {});
    const sessions = new SessionManager(db, store, registry, new ProcessRunner());
    const tokens = new TokenService(db);
    const token = tokens.issue("test-device").token;
    const app = await createHubApp({
      sessions,
      tokens,
      registry,
      auth: { tokens, enforceTailnetIdentity: false },
      projectRoots,
    });
    return { app, token, cleanup: () => rm(dir, { recursive: true, force: true }) };
  }

  it("400s on an invalid body (missing project)", async () => {
    const { app, token, cleanup } = await buildApp([]);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/prompt-enhance",
        headers: { authorization: `Bearer ${token}` },
        payload: { adapter: "claude", text: "hello" },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close().catch(() => undefined);
      await cleanup();
    }
  });

  it("422s when the project path is outside configured projectRoots — same guard as session creation", async () => {
    const root = await mkdtemp(join(tmpdir(), "uacc-enhance-root-"));
    const outside = await mkdtemp(join(tmpdir(), "uacc-enhance-outside-"));
    const { app, token, cleanup } = await buildApp([root]);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/prompt-enhance",
        headers: { authorization: `Bearer ${token}` },
        payload: { adapter: "claude", text: "hello", project: outside },
      });
      expect(res.statusCode).toBe(422);
    } finally {
      await app.close().catch(() => undefined);
      await cleanup();
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("502s with a real message when the adapter isn't wired up for enhancement", async () => {
    const { app, token, cleanup } = await buildApp([]);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/prompt-enhance",
        headers: { authorization: `Bearer ${token}` },
        payload: { adapter: "dummy", text: "hello", project: "/tmp" },
      });
      expect(res.statusCode).toBe(502);
      expect(res.json().error).toContain("dummy");
    } finally {
      await app.close().catch(() => undefined);
      await cleanup();
    }
  });
});

describe("hub server — GET /api/skills (T1.5-10)", () => {
  async function buildApp(projectRoots: string[]) {
    const dir = await mkdtemp(join(tmpdir(), "uacc-srv-skills-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, {});
    const sessions = new SessionManager(db, store, registry, new ProcessRunner());
    const tokens = new TokenService(db);
    const token = tokens.issue("test-device").token;
    const app = await createHubApp({
      sessions,
      tokens,
      registry,
      auth: { tokens, enforceTailnetIdentity: false },
      projectRoots,
    });
    return { app, token, cleanup: () => rm(dir, { recursive: true, force: true }) };
  }

  it("400s without a project query param", async () => {
    const { app, token, cleanup } = await buildApp([]);
    try {
      const res = await app.inject({ method: "GET", url: "/api/skills", headers: { authorization: `Bearer ${token}` } });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close().catch(() => undefined);
      await cleanup();
    }
  });

  it("422s when the project is outside configured projectRoots", async () => {
    const root = await mkdtemp(join(tmpdir(), "uacc-skills-root-"));
    const outside = await mkdtemp(join(tmpdir(), "uacc-skills-outside-"));
    const { app, token, cleanup } = await buildApp([root]);
    try {
      const res = await app.inject({
        method: "GET",
        url: `/api/skills?project=${encodeURIComponent(outside)}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(422);
    } finally {
      await app.close().catch(() => undefined);
      await cleanup();
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("returns a real project's skills/agents when the project is allowed", async () => {
    const root = await mkdtemp(join(tmpdir(), "uacc-skills-root-"));
    const repo = join(root, "repo");
    const skillDir = join(repo, ".claude", "skills", "demo");
    await import("node:fs/promises").then((fs) => fs.mkdir(skillDir, { recursive: true }));
    await import("node:fs/promises").then((fs) =>
      fs.writeFile(join(skillDir, "SKILL.md"), "---\nname: demo\ndescription: a demo skill\n---\n"),
    );
    const { app, token, cleanup } = await buildApp([root]);
    try {
      const res = await app.inject({
        method: "GET",
        url: `/api/skills?project=${encodeURIComponent(repo)}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ items: [{ kind: "skill", name: "demo", description: "a demo skill" }] });
    } finally {
      await app.close().catch(() => undefined);
      await cleanup();
      await rm(root, { recursive: true, force: true });
    }
  });
});
