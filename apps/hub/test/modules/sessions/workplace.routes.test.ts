import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { AdapterRegistry, ClaudeLive, EventStore, HubDatabase, SessionManager, TokenService, WorktreeManager } from "@ancientvoid/core";
import { basicFeatures, type Adapter } from "@ancientvoid/contracts";
import { ProcessRunner } from "@ancientvoid/workers";
import { createHubApp } from "../../../src/app.ts";

const execFileAsync = promisify(execFile);

/** EPIC-P38 (ADR-0057): Arbeitsort über die HTTP-API — Vorschau, Start, Konflikt, Status. */
describe("hub routes — Arbeitsort (EPIC-P38)", () => {
  let root: string;
  let repo: string;
  let app: FastifyInstance;
  let sessions: SessionManager;
  let token: string;
  const cleanup: string[] = [];

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "ancientvoid-p38routes-"));
    repo = join(root, "repo");
    const out = await mkdtemp(join(tmpdir(), "ancientvoid-p38routes-out-"));
    const eventsDir = await mkdtemp(join(tmpdir(), "ancientvoid-p38routes-ev-"));
    cleanup.push(root, out, eventsDir);
    await execFileAsync("git", ["init", "-q", "-b", "main", repo]);
    const git = (...args: string[]) => execFileAsync("git", ["-C", repo, ...args]);
    await git("config", "user.email", "t@ancientvoid.local");
    await git("config", "user.name", "ancientvoid test");
    await writeFile(join(repo, "a.txt"), "x\n");
    await git("add", "-A");
    await git("commit", "-q", "-m", "initial");
    const adapter: Adapter = {
      id: "p38-routes",
      version: "0.0.1",
      capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: false, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures({ followUp: false, interrupt: false }) }),
      async start(_spec, ctx) { return { sessionId: ctx.sessionId }; },
      async steer() { return { ok: true }; },
      async status() { return { state: "healthy" as const }; },
      async stop() {},
    };
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("p38-routes", () => adapter);
    sessions = new SessionManager(db, new EventStore(eventsDir), registry, new ProcessRunner(), undefined, new WorktreeManager(out));
    const tokens = new TokenService(db);
    token = tokens.issue("jan-phone").token;
    app = await createHubApp({
      sessions, tokens, registry,
      claudeLive: new ClaudeLive("claude", async () => "[]"),
      auth: { tokens, enforceTailnetIdentity: false },
      projectRoots: [root],
    });
  });

  afterAll(async () => {
    await sessions.shutdown().catch(() => undefined);
    await app.close().catch(() => undefined);
    for (const dir of cleanup) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  const call = (method: "GET" | "POST", url: string, payload?: unknown) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });

  it("Vorschau zeigt Checkout, Branch und sauberen Zustand — und liegt hinter der projectRoots-Prüfung", async () => {
    const res = await call("GET", `/api/workspace/preview?project=${encodeURIComponent(repo)}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ isGit: true, worktreePossible: true, branch: "main", dirty: [], heldBy: null });
    const outside = await call("GET", `/api/workspace/preview?project=${encodeURIComponent(tmpdir())}`);
    expect(outside.statusCode).toBe(422);
  });

  it("Start mit workspaceMode direct: Record trägt Modus, zweiter Start 422, Status und Vorschau zeigen den Halter", async () => {
    await writeFile(join(repo, "a.txt"), "fremd\n");
    const dirty = await call("POST", "/api/sessions", { adapter: "p38-routes", project: repo, workspaceMode: "direct" });
    expect(dirty.statusCode).toBe(422);
    expect(dirty.json().error).toMatch(/ungesicherte Änderungen/);
    const ok = await call("POST", "/api/sessions", { adapter: "p38-routes", project: repo, workspaceMode: "direct", confirmDirty: true });
    expect(ok.statusCode).toBe(201);
    const rec = ok.json();
    expect(rec.workspaceMode).toBe("direct");
    expect(rec.workspaceBaseline.dirty).toEqual(["a.txt"]);

    const second = await call("POST", "/api/sessions", { adapter: "p38-routes", project: repo, workspaceMode: "direct", confirmDirty: true });
    expect(second.statusCode).toBe(422);
    expect(second.json().error).toMatch(/schreibt bereits/);

    const preview = await call("GET", `/api/workspace/preview?project=${encodeURIComponent(repo)}`);
    expect(preview.json().heldBy).toBe(rec.id);
    const status = await call("GET", `/api/sessions/${rec.id}/workplace`);
    expect(status.json()).toMatchObject({ mode: "direct", path: repo, drift: { headMoved: false, branchChanged: false } });
    expect((await call("GET", "/api/sessions/unbekannt/workplace")).statusCode).toBe(404);
  });

  it("ungültiger workspaceMode ist 400; ohne Angabe bleibt es der Worktree", async () => {
    expect((await call("POST", "/api/sessions", { adapter: "p38-routes", project: repo, workspaceMode: "sandbox" })).statusCode).toBe(400);
    const def = await call("POST", "/api/sessions", { adapter: "p38-routes", project: repo });
    expect(def.statusCode).toBe(201);
    expect(def.json().workspaceMode).toBe("worktree");
  });
});
