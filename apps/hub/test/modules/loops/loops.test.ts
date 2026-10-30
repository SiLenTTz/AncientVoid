import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, ApprovalService, EventStore, HubDatabase, LoopRegistry, SessionManager, TokenService, loopAsAdapter } from "@uacc/core";
import { createFakeLoopConnector } from "@uacc/adapter-testkit";
import { createAdapter as createDummy } from "@uacc/adapter-dummy";
import { createLoopConnector } from "@uacc/loop-securesight-factory";
import { ProcessRunner } from "@uacc/workers";
import type { FastifyInstance } from "fastify";
import { createHubApp } from "../../../src/app.ts";

/** EPIC-P19 T19.3: Loop-Katalog und Start-Policy. */
describe("loops (EPIC-P19)", () => {
  let dir: string;
  let app: FastifyInstance;
  let sessions: SessionManager;
  let loops: LoopRegistry;
  let human: string;
  let agent: string;

  async function call(method: "GET" | "POST", url: string, token: string, payload?: unknown) {
    const res = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });
    return { status: res.statusCode, body: res.json() as never as Record<string, unknown> & unknown[] };
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "uacc-loops-"));
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 1, autoStopAfterEvents: 0 });
    const tokens = new TokenService(db);
    // Wie main.ts: der Connector wird als interner Adapter `loop:<id>` registriert.
    loops = new LoopRegistry();
    const fake = createFakeLoopConnector();
    loops.register(fake);
    registry.register(`loop:${fake.id}`, () => loopAsAdapter(fake, { stateDir: join(dir, "loops") }));
    const approvals = new ApprovalService(db);
    sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    sessions.enableToolPermissions({ approvals, timeoutMs: 60_000 });
    app = await createHubApp({ sessions, tokens, registry, approvals, loops, auth: { tokens, enforceTailnetIdentity: false }, projectRoots: [dir] });
    human = tokens.issue("pixel").token;
    agent = tokens.issue("agent:mcp").token;
  });

  afterEach(async () => {
    await sessions.shutdown();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("GET /api/loops nennt beide Loops, ehrlich als nicht startbar und mit Grund", async () => {
    const res = await call("GET", "/api/loops", human);
    expect(res.status).toBe(200);
    const loops = res.body as unknown as { id: string; label: string; available: boolean; reason?: string; capabilities: { modes: string[] } | null }[];
    expect(loops.map((l) => l.id)).toEqual(["aspark-factory", "securesight-factory", "fake-loop"]);
    expect(loops.filter((l) => !l.available).every((l) => (l.reason ?? "").includes("nicht eingerichtet"))).toBe(true);
    expect(loops.find((l) => l.id === "fake-loop")).toMatchObject({ available: true, capabilities: { modes: ["ruhig", "scharf"] } });
    // Beschriftungen wie „Repo-Token“ sind in Ordnung; Konfigurationswerte und Pfade zu Schlüsseln dürfen nie in der Antwort stehen.
    expect(JSON.stringify(loops)).not.toMatch(/passwordFile|passwordEnvFile|apiKey|geheim/i);
  });

  it("ein Start mit nicht angebundenem Loop wird laut abgelehnt, es entsteht keine Session", async () => {
    const res = await call("POST", "/api/sessions", human, { project: dir, loop: { id: "aspark-factory" } });
    expect(res.status).toBe(422);
    expect(String(res.body.error)).toContain("aSPARK-Factory");
    expect(String(res.body.error)).toContain("nicht eingerichtet");
    expect(sessions.list()).toHaveLength(0);
  });

  it("ein unbekannter Loop ist 422, eine kaputte Kennung 400", async () => {
    expect((await call("POST", "/api/sessions", human, { project: dir, loop: { id: "gibtsnicht" } })).status).toBe(422);
    expect((await call("POST", "/api/sessions", human, { project: dir, loop: { id: "../x" } })).status).toBe(400);
  });

  it("AC-P19-8: ein Agenten-Token kann keinen Loop starten, auch nicht beantragen", async () => {
    const res = await call("POST", "/api/sessions", agent, { project: dir, loop: { id: "fake-loop", options: { line: "alpha" } } });
    expect(res.status).toBe(403);
    expect(sessions.list()).toHaveLength(0);
  });

  it("AC-P19-5: ohne Loop startet die Session wie vorher", async () => {
    const res = await call("POST", "/api/sessions", human, { adapter: "dummy", project: dir, prompt: "hallo" });
    expect(res.status).toBe(201);
  });

  it("adapter und loop zusammen oder keines von beiden: 400", async () => {
    expect((await call("POST", "/api/sessions", human, { adapter: "dummy", project: dir, loop: { id: "fake-loop", options: { line: "alpha" } } })).status).toBe(400);
    expect((await call("POST", "/api/sessions", human, { project: dir })).status).toBe(400);
  });

  it("ein startbarer Loop wird zur Session des internen Adapters, ohne Worktree, mit Info-Ereignis", async () => {
    const res = await call("POST", "/api/sessions", human, { project: dir, prompt: "los", loop: { id: "fake-loop", mode: "ruhig", options: { line: "alpha" } } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ adapter: "loop:fake-loop", status: "working" });
    const id = String(res.body.id);
    const events = (await call("GET", `/api/sessions/${id}/events`, human)).body as unknown as { payload?: { kind?: string; line?: string; reason?: string } }[];
    expect(events.find((e) => e.payload?.kind === "loop.info")?.payload).toMatchObject({ line: "alpha" });
    expect(events.some((e) => e.payload?.kind === "session.no_worktree_isolation" && e.payload.reason === "loop works in its own project")).toBe(true);
    // die interne Adapter-Id taucht in der normalen Adapter-Liste nicht auf
    const adapters = (await call("GET", "/api/adapters", human)).body as unknown as { id: string }[];
    expect(adapters.some((a) => a.id.startsWith("loop:"))).toBe(false);
  });

  it("fehlende Pflichtoption und unbekannte Betriebsart sind 422 mit Grund", async () => {
    const missing = await call("POST", "/api/sessions", human, { project: dir, loop: { id: "fake-loop" } });
    expect(missing.status).toBe(422);
    expect(String(missing.body.error)).toContain("Option „Line“ fehlt");
    const mode = await call("POST", "/api/sessions", human, { project: dir, loop: { id: "fake-loop", mode: "dark", options: { line: "alpha" } } });
    expect(String(mode.body.error)).toContain("Betriebsart „dark“");
  });

  it("die Betriebsart wechselt über den normalen Modus-Weg (configure), eine Rückfrage landet in den Freigaben", async () => {
    const res = await call("POST", "/api/sessions", human, { project: dir, prompt: "FRAGE", loop: { id: "fake-loop", options: { line: "alpha" } } });
    const id = String(res.body.id);
    const steer = await call("POST", `/api/sessions/${id}/steer`, human, { kind: "configure", permissionMode: "scharf" });
    expect(steer.status).toBe(200);
    const events = (await call("GET", `/api/sessions/${id}/events`, human)).body as unknown as { payload?: { kind?: string; mode?: string; toolName?: string } }[];
    expect(events.find((e) => e.payload?.kind === "loop.command")?.payload).toMatchObject({ mode: "scharf" });
    expect(events.find((e) => e.payload?.kind === "tool.permission_requested")?.payload).toMatchObject({ toolName: "AskUserQuestion" });
  });

  it("Onboarding: ein Mensch richtet eine Linie ein, danach ist sie startbar; das Token taucht nirgends auf (EPIC-P19)", async () => {
    const before = await call("POST", "/api/sessions", human, { project: dir, loop: { id: "fake-loop", options: { line: "beta" } } });
    expect(before.status).toBe(422);
    const res = await call("POST", "/api/loops/fake-loop/onboard", human, { options: { name: "beta" }, secret: "geheim" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, options: { line: "beta" } });
    expect(JSON.stringify(res.body)).not.toContain("geheim");
    const after = await call("POST", "/api/sessions", human, { project: dir, loop: { id: "fake-loop", options: { line: "beta" } } });
    expect(after.status).toBe(201);
  });

  it("Onboarding ohne Geheimnis: securesight factory init braucht kein Secret (T26.4, EPIC-P26)", async () => {
    const binDir = await mkdtemp(join(tmpdir(), "uacc-factory-init-"));
    const bin = join(binDir, "factory.sh");
    await writeFile(bin, `#!/bin/sh\nif [ "$1" = "init" ]; then printf '%s' '{"root":"/x","checkliste":["git: ok","ready: lauf kann starten"]}'; exit 0; fi\nprintf '%s' '{"schema_version":"1","total":0,"done":0,"stories":[],"now":null,"updated_at":null,"events":[]}'\n`, { mode: 0o755 });
    try {
      const connector = createLoopConnector({ factory: bin });
      loops.register(connector);
      const res = await call("POST", "/api/loops/securesight-factory/onboard", human, { options: { root: "/tmp/proj", modus: "a", provider: "zai" } });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true, options: { anbindung: "bestehend" } });
      expect(JSON.stringify(res.body)).toContain("ready:");
      // Agent bleibt draußen (AC-P26-5)
      expect((await call("POST", "/api/loops/securesight-factory/onboard", agent, { options: { root: "/tmp/proj", modus: "a", provider: "zai" } })).status).toBe(403);
    } finally {
      await rm(binDir, { recursive: true, force: true });
    }
  });

  it("Onboarding: abgelehntes Token = 422 mit Grund; fehlendes Geheimnis = 400; unbekannter Loop = 404; Agenten = 403", async () => {
    expect(await call("POST", "/api/loops/fake-loop/onboard", human, { options: { name: "beta" }, secret: "falsch" })).toMatchObject({ status: 422, body: { ok: false, detail: "Der Token wurde abgelehnt" } });
    expect((await call("POST", "/api/loops/fake-loop/onboard", human, { options: { name: "beta" } })).status).toBe(400);
    expect((await call("POST", "/api/loops/aspark-factory/onboard", human, { options: {}, secret: "x" })).status).toBe(404);
    expect((await call("POST", "/api/loops/fake-loop/onboard", agent, { options: { name: "beta" }, secret: "geheim" })).status).toBe(403);
  });

  it("die Auswahl „Neues Repo anbinden“ startet nie eine Session, bevor angebunden ist", async () => {
    const res = await call("POST", "/api/sessions", human, { project: dir, loop: { id: "fake-loop", options: { line: "+neu" } } });
    expect(res.status).toBe(422);
    expect(String(res.body.error)).toContain("angebunden");
    expect(sessions.list()).toHaveLength(0);
  });

  it("AC-P19-8: ein Agenten-Token kann die Betriebsart einer Loop-Session nicht wechseln und nicht fortsetzen", async () => {
    const created = await call("POST", "/api/sessions", human, { project: dir, loop: { id: "fake-loop", mode: "ruhig", options: { line: "alpha" } } });
    const id = String(created.body.id);
    for (const body of [{ kind: "configure", permissionMode: "scharf" }, { kind: "resume" }]) {
      const res = await call("POST", `/api/sessions/${id}/steer`, agent, body);
      expect(res.status).toBe(422);
    }
    // der Loop hat nichts davon gesehen
    await new Promise((r) => setTimeout(r, 200));
    const cmds = ((await call("GET", `/api/sessions/${id}/events?limit=200`, human)).body as unknown as { payload?: { kind?: string } }[]).filter((e) => e.payload?.kind === "loop.command");
    expect(cmds).toHaveLength(0);
  });
});

