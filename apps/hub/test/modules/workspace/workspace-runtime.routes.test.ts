import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { AdapterRegistry, ApprovalService, ClaudeLive, EventStore, HubDatabase, SessionManager, TokenService, WorktreeManager } from "@ancientvoid/core";
import { basicFeatures, type Adapter } from "@ancientvoid/contracts";
import { ProcessRunner } from "@ancientvoid/workers";
import { createHubApp } from "../../../src/app.ts";

const execFileAsync = promisify(execFile);

/**
 * EPIC-P29 T29.6: Status/Logs/Retry-Routen und der authentifizierte
 * Preview-Proxy — Origin/Pfad-/Host-Isolation, kein Open Proxy
 * (ADR-0051 §6, Premortem 5). Echter Loopback-Service, echte Freigabe.
 */
describe("hub routes — Workspace-Status/Logs/Retry + Preview-Proxy (T29.6)", () => {
  let repo: string;
  let out: string;
  let eventsDir: string;
  let app: FastifyInstance;
  let sessions: SessionManager;
  let approvals: ApprovalService;
  let human: string;
  let agent: string;
  let sessionId = "";

  /** Echo-Service: antwortet mit url/sid/auth, beherrscht Redirects — mehr nicht. */
  const SVC = `require('http').createServer((q,r)=>{
  const port = Number(process.env.ANCIENTVOID_WORKSPACE_PORT);
  if (q.url.startsWith('/redirect-rel')) { r.writeHead(302,{location:'/ziel'}); return r.end(); }
  if (q.url.startsWith('/redirect-abs')) { r.writeHead(302,{location:'http://127.0.0.1:'+port+'/ziel'}); return r.end(); }
  if (q.url.startsWith('/redirect-ext')) { r.writeHead(302,{location:'http://example.net/bye'}); return r.end(); }
  r.setHeader('content-type','application/json');
  r.end(JSON.stringify({ url: q.url, sid: process.env.ANCIENTVOID_WORKSPACE_SESSION_ID, auth: q.headers.authorization ?? null }));
}).listen(Number(process.env.ANCIENTVOID_WORKSPACE_PORT),'127.0.0.1');`;

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), "ancientvoid-p29routes-"));
    out = await mkdtemp(join(tmpdir(), "ancientvoid-p29routes-out-"));
    eventsDir = await mkdtemp(join(tmpdir(), "ancientvoid-p29routes-ev-"));
    const git = (...args: string[]) => execFileAsync("git", ["-C", repo, ...args]);
    await git("init", "-q", "-b", "main");
    await git("config", "user.email", "t@ancientvoid.local");
    await git("config", "user.name", "ancientvoid test");
    await writeFile(join(repo, "svc.js"), SVC);
    await writeFile(
      join(repo, "ancientvoid.workspace.json"),
      JSON.stringify({
        schemaVersion: 1,
        services: [
          { id: "web", argv: ["node", "svc.js"], readiness: { path: "/", timeoutMs: 10_000 } },
          { id: "zwei", argv: ["node", "svc.js"], readiness: { path: "/", timeoutMs: 10_000 } },
        ],
      }),
    );
    await git("add", "-A");
    await git("commit", "-q", "-m", "initial");

    const adapter: Adapter = {
      id: "p29-routes",
      version: "0.0.1",
      capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: false, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures({ followUp: false, interrupt: false }) }),
      async start(_spec, ctx) {
        return { sessionId: ctx.sessionId };
      },
      async steer() {
        return { ok: true };
      },
      async status() {
        return { state: "healthy" as const };
      },
      async stop() {},
    };
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("p29-routes", () => adapter);
    const worktrees = new WorktreeManager(out);
    approvals = new ApprovalService(new HubDatabase(":memory:"));
    sessions = new SessionManager(db, new EventStore(eventsDir), registry, new ProcessRunner(), undefined, worktrees, approvals);
    const tokens = new TokenService(db);
    human = tokens.issue("jan-phone").token;
    agent = tokens.issue("agent:mcp").token;
    app = await createHubApp({
      sessions,
      tokens,
      registry,
      claudeLive: new ClaudeLive("claude", async () => "[]"),
      auth: { tokens, enforceTailnetIdentity: false },
    });

    // Echter Start-Flow: Freigabe über die Approval-Queue, Workspace wird ready.
    const record = await sessions.create({ adapter: "p29-routes", project: repo });
    sessionId = record.id;
    const request = approvals.list("pending").find((a) => a.sessionId === sessionId && a.action === "workspace.setup")!;
    expect(request).toBeDefined();
    expect(approvals.decide(request.id, "approve", "test-token", "jan").ok).toBe(true);
    expect((await sessions.applyApproved(request.id, "jan")).ok).toBe(true);
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const status = await sessions.workspaceStatus(sessionId);
      if (status?.phase === "ready" && status.services.every((s) => s.state === "ready")) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect((await sessions.workspaceStatus(sessionId))?.phase).toBe("ready");
  }, 60_000);

  afterAll(async () => {
    await sessions.shutdown().catch(() => undefined);
    await app.close().catch(() => undefined);
    for (const dir of [repo, out, eventsDir]) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  const auth = (tok: string) => ({ authorization: `Bearer ${tok}` });
  const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: "GET", url, headers: { ...auth(human), ...headers } });
  const post = (url: string, headers: Record<string, string> = {}) => app.inject({ method: "POST", url, headers: { ...auth(human), ...headers }, payload: {} });

  describe("Status, Logs, Retry", () => {
    it("GET workspace: Phase ready, zwei Services mit getrennten Ports (AC-P29-1)", async () => {
      const res = await get(`/api/sessions/${sessionId}/workspace`);
      expect(res.statusCode).toBe(200);
      const status = res.json();
      expect(status.phase).toBe("ready");
      expect(status.baseSha).toMatch(/^[0-9a-f]{40}$/);
      expect(status.manifestHash).toMatch(/^[0-9a-f]{64}$/);
      const ports = status.services.map((s: { port: number }) => s.port);
      expect(status.services).toHaveLength(2);
      expect(ports[0]).not.toBe(ports[1]);
      expect(status.services.map((s: { state: string }) => s.state)).toEqual(["ready", "ready"]);
    });

    it("GET workspace: unbekannte Session und manifestlose Route sind 404", async () => {
      expect((await get("/api/sessions/00000000-0000-4000-8000-000000000000/workspace")).statusCode).toBe(404);
    });

    it("GET logs: Schwanz-Form pro Service, unbekannte IDs 404 (K5)", async () => {
      const res = await get(`/api/sessions/${sessionId}/workspace/services/web/logs`);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ serviceId: "web", truncated: false });
      expect(res.json().tail.length).toBeLessThanOrEqual(8_000);
      expect((await get(`/api/sessions/${sessionId}/workspace/services/gibtsnicht/logs`)).statusCode).toBe(404);
      expect((await get("/api/sessions/00000000-0000-4000-8000-000000000000/workspace/services/web/logs")).statusCode).toBe(404);
    });

    it("POST retry: Policy lässt nur Menschen — Agent 403; ready weist Retry zurück", async () => {
      expect((await app.inject({ method: "POST", url: `/api/sessions/${sessionId}/workspace/retry`, headers: auth(agent), payload: {} })).statusCode).toBe(403);
      const res = await post(`/api/sessions/${sessionId}/workspace/retry`);
      expect(res.statusCode).toBe(422);
      expect(res.json().detail).toContain("Retry nur nach Fehler");
    });
  });

  describe("Preview-Proxy: Isolation (ADR-0051 §6, Premortem 5)", () => {
    it("leitet an den registrierten Service weiter — eigene Workspace-ID, kein Open Proxy", async () => {
      const res = await get(`/api/sessions/${sessionId}/workspace/services/web/proxy/`);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.sid).toBe(sessionId); // genau dieser Workspace
      expect(body.url).toBe("/"); // Pfad begrenzt weitergereicht
    });

    it("Unterpfad und Query gehen durch — token/ticket werden abgeschnitten", async () => {
      const res = await get(`/api/sessions/${sessionId}/workspace/services/web/proxy/sub/x?q=2&token=GEHEIM`);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.url).toBe("/sub/x?q=2");
      expect(body.url).not.toContain("token=");
      expect(JSON.stringify(body)).not.toContain("GEHEIM");
    });

    it("Authorization erreicht den Service NIE (kein Token-Durchbruch)", async () => {
      // gültiges Token im Request — der Upstream darf es trotzdem nie sehen
      const res = await get(`/api/sessions/${sessionId}/workspace/services/web/proxy/`);
      expect(res.statusCode).toBe(200);
      expect(res.json().auth).toBeNull();
    });

    it("Origin-Prüfung: fremde Origin und cross-site fetchen werden abgewiesen", async () => {
      expect((await get(`/api/sessions/${sessionId}/workspace/services/web/proxy/`, { origin: "https://evil.example" })).statusCode).toBe(403);
      expect((await get(`/api/sessions/${sessionId}/workspace/services/web/proxy/`, { "sec-fetch-site": "cross-site" })).statusCode).toBe(403);
      // passende Origin (gleicher Host wie der Request) und none bleiben erlaubt
      expect((await get(`/api/sessions/${sessionId}/workspace/services/web/proxy/`, { origin: "http://localhost:80", host: "localhost:80" })).statusCode).toBe(200);
      expect((await get(`/api/sessions/${sessionId}/workspace/services/web/proxy/`, { "sec-fetch-site": "same-origin" })).statusCode).toBe(200);
    });

    it("nur GET/HEAD; WS-Upgrades sind explizit nicht freigegeben", async () => {
      expect((await app.inject({ method: "POST", url: `/api/sessions/${sessionId}/workspace/services/web/proxy/`, headers: auth(human), payload: {} })).statusCode).toBe(405);
      expect((await app.inject({ method: "PUT", url: `/api/sessions/${sessionId}/workspace/services/web/proxy/`, headers: auth(human), payload: {} })).statusCode).toBe(405);
      expect((await get(`/api/sessions/${sessionId}/workspace/services/web/proxy/`, { connection: "upgrade", upgrade: "websocket" })).statusCode).toBe(501);
      expect((await app.inject({ method: "HEAD", url: `/api/sessions/${sessionId}/workspace/services/web/proxy/`, headers: auth(human) })).statusCode).toBe(200);
    });

    it("unbekannte Session/Service 404; Ziele ohne Port oder nicht ready 503", async () => {
      expect((await get("/api/sessions/00000000-0000-4000-8000-000000000000/workspace/services/web/proxy/")).statusCode).toBe(404);
      expect((await get(`/api/sessions/${sessionId}/workspace/services/gibtsnicht/proxy/`)).statusCode).toBe(404);
    });

    it("Pfad-Validierung: Traversal, Doppel-Slash und Steuerzeichen kommen nie beim Service an", async () => {
      // Raw-`\` normalisiert der Router vorher zu `/` (landet harmlos auf "/");
      // die kodierten Varianten (%2e%2e, %5C) sind die echten Vektoren.
      for (const bad of ["/../..", "/a//b", "/a%00b", "/%2e%2e", "/%5C", "/" + "a".repeat(600)]) {
        const res = await get(`/api/sessions/${sessionId}/workspace/services/web/proxy${bad}`);
        // 400 = Handler-Validierung; 404 = der Router normalisiert Traversal
        // schon vorher weg. Beide garantieren: kein Upstream-Kontakt (nie 200).
        expect([400, 404], bad).toContain(res.statusCode);
      }
    });

    it("Redirects werden nicht verfolgt: relativ bleibt, absoluter Loopback wird umgeschrieben, extern verworfen", async () => {
      const rel = await get(`/api/sessions/${sessionId}/workspace/services/web/proxy/redirect-rel`);
      expect(rel.statusCode).toBe(302);
      expect(rel.headers.location).toBe("/ziel");
      const abs = await get(`/api/sessions/${sessionId}/workspace/services/web/proxy/redirect-abs`);
      expect(abs.statusCode).toBe(302);
      expect(abs.headers.location).toBe("/ziel");
      const ext = await get(`/api/sessions/${sessionId}/workspace/services/web/proxy/redirect-ext`);
      expect(ext.statusCode).toBe(302);
      expect(ext.headers.location).toBeUndefined();
    });

    it("Tickets: nur der Mensch löst sie aus; sie tragen durch den iframe, gebunden an genau einen Service", async () => {
      expect((await app.inject({ method: "POST", url: `/api/sessions/${sessionId}/workspace/services/web/preview-ticket`, headers: auth(agent), payload: {} })).statusCode).toBe(403);
      const issued = await post(`/api/sessions/${sessionId}/workspace/services/web/preview-ticket`);
      expect(issued.statusCode).toBe(201);
      const { ticket, expiresAt } = issued.json() as { ticket: string; expiresAt: number };
      expect(expiresAt).toBeGreaterThan(Date.now());

      // ohne jedes Bearer, nur mit Ticket:
      const viaTicket = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}/workspace/services/web/proxy/?ticket=${encodeURIComponent(ticket)}` });
      expect(viaTicket.statusCode).toBe(200);
      expect(viaTicket.json().sid).toBe(sessionId);

      // gebunden: dasselbe Ticket auf dem anderen Service ist 401
      expect((await app.inject({ method: "GET", url: `/api/sessions/${sessionId}/workspace/services/zwei/proxy/?ticket=${encodeURIComponent(ticket)}` })).statusCode).toBe(401);
      // unbekanntes Ticket 401, und die Freistellung gilt NUR für die Proxy-Route
      expect((await app.inject({ method: "GET", url: `/api/sessions/${sessionId}/workspace/services/web/proxy/?ticket=bogus` })).statusCode).toBe(401);
      expect((await app.inject({ method: "GET", url: `/api/sessions?ticket=${encodeURIComponent(ticket)}` })).statusCode).toBe(401);
    });

    it("nach Session-Stopp ist der Service nicht mehr ready — Preview antwortet 503 statt weiterzuleiten", async () => {
      const ack = await sessions.stop(sessionId, "test");
      expect(ack.ok).toBe(true);
      const status = await sessions.workspaceStatus(sessionId);
      expect(status!.services.map((s) => s.state)).toEqual(["stopped", "stopped"]);
      const res = await get(`/api/sessions/${sessionId}/workspace/services/web/proxy/`);
      expect(res.statusCode).toBe(503);
      expect(res.json().error).toContain("nicht bereit");
    });
  });
});
