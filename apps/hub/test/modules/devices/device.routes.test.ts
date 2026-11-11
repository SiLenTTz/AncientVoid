import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, DeviceService, EventStore, HubDatabase, SessionManager, TokenService } from "@ancientvoid/core";
import { createAdapter as createDummy } from "@ancientvoid/adapter-dummy";
import { ProcessRunner } from "@ancientvoid/workers";
import type { FastifyInstance } from "fastify";
import { createHubApp } from "../../../src/app.ts";

/** EPIC-P42 (ADR-0067): Auth, Menschen-only, Eingabevalidierung und ehrliche Nichtverfügbarkeit der Geräte-Routen. */
describe("device routes (EPIC-P42)", () => {
  let dir: string;
  let app: FastifyInstance;
  let sessions: SessionManager;
  let tokens: TokenService;
  let human: string;
  let agent: string;
  let sid: string;

  const call = (method: "GET" | "POST", path: string, token: string | null, payload?: unknown) =>
    app.inject({ method, url: `/api/devices${path}`, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload: payload as object } : {}) });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-device-routes-"));
    const project = join(dir, "proj");
    await mkdir(project, { recursive: true });
    await writeFile(join(project, "a.txt"), "x");
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: project });
    execFileSync("git", ["add", "-A"], { cwd: project });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: project });
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 1, autoStopAfterEvents: 0 });
    tokens = new TokenService(db);
    sessions = new SessionManager(db, new EventStore(join(dir, "data")), registry, new ProcessRunner());
    // Kein SDK: capabilities bleiben ehrlich „nicht bereit“, die Routen melden 503 mit Grund.
    const devices = new DeviceService({ dataDir: join(dir, "data"), sdkRoot: join(dir, "gibts-nicht-sdk"), kvmPath: join(dir, "kein-kvm") });
    app = await createHubApp({ sessions, tokens, registry, devices, auth: { tokens, enforceTailnetIdentity: false }, projectRoots: [dir], dataDir: join(dir, "data") });
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

  it("alle Routen verlangen Auth; ohne Dienst antwortet /api/devices 501", async () => {
    const bare = await createHubApp({ sessions, tokens, registry: new AdapterRegistry(), auth: { tokens, enforceTailnetIdentity: false }, projectRoots: [dir], dataDir: join(dir, "data-bare") });
    expect((await bare.inject({ method: "GET", url: "/api/devices" })).statusCode).toBe(401); // Auth zuerst
    expect((await bare.inject({ method: "GET", url: "/api/devices", headers: { authorization: `Bearer ${human}` } })).statusCode).toBe(501); // ehrliche Abschaltung
    await bare.close();

    expect((await call("GET", "", null)).statusCode).toBe(401);
    expect((await call("GET", "/emulator-5554/frame", null)).statusCode).toBe(401);
    expect((await call("POST", "/start", null, {})).statusCode).toBe(401);
  });

  it("Agent-Tokens dürfen nichts Schreibendes (Menschen-only, fail closed)", async () => {
    for (const [path, body] of [
      ["/start", { avd: "x" }],
      ["/stop", { serial: "emulator-5554" }],
      ["/lease", { serial: "emulator-5554" }],
      ["/release", { serial: "emulator-5554", generation: 1 }],
      ["/action", { serial: "emulator-5554", generation: 1, geometryVersion: 1, action: { type: "key", key: "back" } }],
      ["/install", { serial: "emulator-5554", generation: 1, attachmentId: "a".repeat(64) }],
      ["/tests", { test: { name: "x", serial: "emulator-5554", steps: [{ type: "wait", ms: 500 }] } }],
    ] as const) {
      expect((await call("POST", path, agent, body)).statusCode, path).toBe(403);
    }
  });

  it("fehlendes SDK: Start 503 mit Grund; Status bleibt lesbar und nennt ihn (Skip ≠ Pass)", async () => {
    const res = await call("POST", "/start", human, { avd: "av-test" });
    expect(res.statusCode).toBe(503);
    expect((res.json() as { code: string }).code).toBe("unavailable");
    const st = (await call("GET", "", human)).json() as { capabilities: { ready: boolean; reasons: string[] } };
    expect(st.capabilities.ready).toBe(false);
    expect(st.capabilities.reasons.join(" ")).toMatch(/SDK|KVM/);
  });

  it("ungültige Eingaben: 400 (avd, serial, action, test, attachmentId)", async () => {
    expect((await call("POST", "/start", human, { avd: "" })).statusCode).toBe(400);
    expect((await call("POST", "/stop", human, { serial: "böser;serial" })).statusCode).toBe(400);
    expect((await call("POST", "/action", human, { serial: "emulator-5554", generation: 1, geometryVersion: 1, action: { type: "shell", cmd: "rm -rf /" } })).statusCode).toBe(400);
    expect((await call("POST", "/action", human, { serial: "emulator-5554", generation: 1, geometryVersion: 1, action: { type: "text", text: "" } })).statusCode).toBe(400);
    expect((await call("POST", "/tests", human, { test: { name: "x", serial: "emulator-5554", steps: [{ type: "skript", code: "1" }] } })).statusCode).toBe(400);
    expect((await call("POST", "/install", human, { serial: "emulator-5554", generation: 1, attachmentId: "kurz" })).statusCode).toBe(400);
  });

  it("Frame ohne Gerät: 204; Testliste leer; Lease auf unbekanntem Gerät: 404", async () => {
    expect((await call("GET", "/emulator-5554/frame", human)).statusCode).toBe(204);
    expect(((await call("GET", "/tests", human)).json() as { runs: unknown[] }).runs).toEqual([]);
    expect((await call("POST", "/lease", human, { serial: "emulator-7777", sessionId: sid })).statusCode).toBe(404);
  });

  it("Status trägt sessionId-Kontext der Lease (Session-Bindung über Body)", async () => {
    // Ohne SDK bleibt acquire auf 503/404 — hier nur die Form des Lease-Endpunkts prüfen.
    const res = await call("POST", "/lease", human, { serial: "emulator-5554;rm", sessionId: sid });
    expect(res.statusCode).toBe(400);
  });
});
