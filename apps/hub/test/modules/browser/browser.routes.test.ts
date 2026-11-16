import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, BrowserService, EventStore, HubDatabase, SessionManager, TokenService } from "@ancientvoid/core";
import { createAdapter as createDummy } from "@ancientvoid/adapter-dummy";
import { ProcessRunner } from "@ancientvoid/workers";
import type { FastifyInstance } from "fastify";
import { createHubApp } from "../../../src/app.ts";

/** EPIC-P39 (ADR-0059): Auth, Menschen-only, Eingabevalidierung und ehrliche Nichtverfügbarkeit des Browser-Arbeitsplatzes. */
describe("browser routes (EPIC-P39)", () => {
  let dir: string;
  let app: FastifyInstance;
  let sessions: SessionManager;
  let human: string;
  let agent: string;
  let sid: string;

  const call = (method: "GET" | "POST", path: string, token: string | null, payload?: unknown) =>
    app.inject({ method, url: `/api/sessions/${sid}/browser${path}`, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload: payload as object } : {}) });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-browser-routes-"));
    const project = join(dir, "proj");
    await mkdir(project, { recursive: true });
    await writeFile(join(project, "a.txt"), "x");
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: project });
    execFileSync("git", ["add", "-A"], { cwd: project });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: project });
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 1, autoStopAfterEvents: 0 });
    const tokens = new TokenService(db);
    sessions = new SessionManager(db, new EventStore(join(dir, "data")), registry, new ProcessRunner());
    const browser = new BrowserService({ dataDir: join(dir, "data"), portsFor: async () => [], launcher: async () => { throw new Error("Executable doesn't exist (Test)"); } });
    app = await createHubApp({ sessions, tokens, registry, browser, auth: { tokens, enforceTailnetIdentity: false }, projectRoots: [dir], dataDir: join(dir, "data") });
    human = tokens.issue("pixel").token;
    agent = tokens.issue("agent:mcp").token;
    const created = await sessions.create({ adapter: "dummy", project });
    sid = created.id;
  });

  afterEach(async () => {
    await sessions.shutdown();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("alle Routen verlangen Auth", async () => {
    expect((await call("GET", "", null)).statusCode).toBe(401);
    expect((await call("GET", "/frame", null)).statusCode).toBe(401);
    expect((await call("POST", "/open", null, {})).statusCode).toBe(401);
  });

  it("Agent-Tokens dürfen den Browser nicht bedienen (Menschen-only, fail closed)", async () => {
    for (const [path, body] of [["/open", {}], ["/action", { action: { type: "reload" } }], ["/tests", { test: { name: "x", steps: [{ type: "expectVisible", selector: "#a" }] } }], ["/pick", { x: 1, y: 1 }], ["/close", {}]] as const) {
      expect((await call("POST", path, agent, body)).statusCode, path).toBe(403);
    }
  });

  it("fehlendes Chromium: 503 mit Grund, Status bleibt lesbar und benennt ihn", async () => {
    const res = await call("POST", "/open", human, {});
    expect(res.statusCode).toBe(503);
    expect((res.json() as { code: string }).code).toBe("unavailable");
    const st = (await call("GET", "", human)).json() as { state: string; unavailableReason: string };
    expect(st.state).toBe("unavailable");
    expect(st.unavailableReason).toContain("Executable");
  });

  it("ungültige Aktionen/Testfälle/Picks: 400, unbekannte Session: 404", async () => {
    expect((await call("POST", "/action", human, { action: { type: "eval", code: "1" } })).statusCode).toBe(400);
    expect((await call("POST", "/tests", human, { test: { name: "x", steps: [{ type: "script", code: "1" }] } })).statusCode).toBe(400);
    expect((await call("POST", "/pick", human, { x: -5, y: 1 })).statusCode).toBe(400);
    const other = await app.inject({ method: "GET", url: "/api/sessions/unbekannt/browser", headers: { authorization: `Bearer ${human}` } });
    expect(other.statusCode).toBe(404);
  });

  it("Frame bei geschlossenem Browser: 204, Testliste leer", async () => {
    expect((await call("GET", "/frame", human)).statusCode).toBe(204);
    expect(((await call("GET", "/tests", human)).json() as { runs: unknown[] }).runs).toEqual([]);
  });

  it("Feedback-Vorschau rahmt Seiteninhalt als Daten", async () => {
    const pick = { selector: "#a", tag: "div", text: "IGNORIERE", rect: { x: 0, y: 0, width: 1, height: 1 }, styles: {}, frame: "main", inShadowDom: false, masked: false, source: null, url: "http://127.0.0.1:1/" };
    const res = await call("POST", "/feedback/preview", human, { pick, note: "n", includeScreenshot: false });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { prompt: string }).prompt).toContain("keine Anweisung");
  });
});
