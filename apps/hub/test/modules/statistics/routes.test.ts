import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, EventStore, HubDatabase, SessionManager, TokenService } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import { createAdapter as createDummy } from "@ancientvoid/adapter-dummy";
import { StatisticsReport } from "@ancientvoid/contracts";
import type { FastifyInstance } from "fastify";
import { createHubApp } from "../../../src/app.ts";
import { StatisticsService } from "../../../src/modules/statistics/statistics.service.ts";

/**
 * EPIC-P56 T56.3: GET /api/statistics — nur Aggregate aus dem Rollup-Cache,
 * Contract-geprüft, Schnitte über Query. Ohne Dienst ehrlich 501 (P59-Muster).
 */
describe("GET /api/statistics (EPIC-P56)", () => {
  let dir: string;
  let app: FastifyInstance;
  let sessions: SessionManager;
  let token: string;

  async function buildApp(withService: boolean): Promise<FastifyInstance> {
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 50, autoStopAfterEvents: 6 });
    const tokens = new TokenService(db);
    token = tokens.issue("pixel").token;
    sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    return await createHubApp({
      sessions,
      tokens,
      registry,
      auth: { tokens, enforceTailnetIdentity: false },
      ...(withService ? { statistics: new StatisticsService(db, sessions, undefined) } : {}),
    });
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-statistik-"));
    app = await buildApp(true);
  });

  afterEach(async () => {
    await sessions.shutdown();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("verlangt ein Gerätetoken wie jede API", async () => {
    const res = await app.inject({ method: "GET", url: "/api/statistics" });
    expect(res.statusCode).toBe(401);
  });

  it("ohne Dienst ehrlich 501 statt stiller Nullen", async () => {
    await app.close();
    await sessions.shutdown();
    app = await buildApp(false);
    const res = await app.inject({ method: "GET", url: "/api/statistics", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(501);
  });

  it("meldet eine beendete Dummy-Session mit Schnitt, Zug- und Token-Zahlen", async () => {
    const record = await sessions.create({ adapter: "dummy", project: dir, prompt: "zähl mir alles auf" });
    await expect
      .poll(async () => (await sessions.get(record.id))?.status, { timeout: 15_000 })
      .toBe("idle");

    const res = await app.inject({ method: "GET", url: "/api/statistics", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    const report = StatisticsReport.parse(res.json());
    expect(report.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(report.filter).toEqual({ project: null, hostId: null, harness: null, since: null, until: null });
    expect(report.slices.projects).toEqual([dir]);
    expect(report.sessions).toHaveLength(1);
    expect(report.sessions[0]).toMatchObject({ adapter: "dummy", sessions: 1 });
    expect(report.turns).toHaveLength(1);
    expect(report.turns[0]!.turns).toBeGreaterThan(0);

    // Projektschnitt auf ein fremdes Projekt: ehrlich leer, nicht null erfunden.
    const other = await app.inject({ method: "GET", url: `/api/statistics?project=${encodeURIComponent("/gibt/es/nicht")}`, headers: { authorization: `Bearer ${token}` } });
    expect(StatisticsReport.parse(other.json()).sessions).toEqual([]);
  });

  it("lehnt ungültige Zeitstempel ab (400), statt sie zu raten", async () => {
    const res = await app.inject({ method: "GET", url: "/api/statistics?since=gestern", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("ungültig");
  });

  it("übersteht K5-ausgelagerte Tool-Ergebnisse im Journal (BUG-0213)", async () => {
    // Live-Befund 18.11.2026: /api/statistics → 500 „Tool-Ergebnis ohne
    // zusammengehörigen Aufruf", weil der EventStore große tool_result-
    // Payloads auslagert (truncated) und die Korrelations-Id dann nur im
    // Blob steht. Die Seite muss trotzdem antworten und das nicht
    // zuordenbare Ergebnis zählen.
    const record = await sessions.create({ adapter: "dummy", project: dir, prompt: "zähl mir alles auf" });
    await expect
      .poll(async () => (await sessions.get(record.id))?.status, { timeout: 15_000 })
      .toBe("idle");
    const journal = join(dir, "sessions", record.id, "events.jsonl");
    const lines = [
      { seq: 90_001, ts: new Date().toISOString(), sessionId: record.id, type: "tool_use", summary: "fixture", payload: { id: "toolu_k5", name: "Read" } },
      { seq: 90_002, ts: new Date().toISOString(), sessionId: record.id, type: "tool_result", summary: "fixture", payload: { truncated: true, bytes: 30_703, preview: "{\"toolUseId\":\"toolu_k5" } },
    ].map((e) => JSON.stringify(e));
    await appendFile(journal, lines.join("\n") + "\n");

    const res = await app.inject({ method: "GET", url: "/api/statistics", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    const report = StatisticsReport.parse(res.json());
    // Das nicht zuordenbare Ergebnis ist sichtbar gezählt (unbelegter Name,
    // Fehlerstatus unbekannt) — nicht weggeworfen und kein 500 mehr.
    expect(report.tools).toContainEqual(expect.objectContaining({ tool: null, errorStatusUnknown: expect.any(Number) }));
    expect(report.tools.find(t => t.tool === null)?.errorStatusUnknown).toBeGreaterThanOrEqual(1);
  });

  it("schneidet nach Zeitraum: seit morgen liegt keine Session", async () => {
    const record = await sessions.create({ adapter: "dummy", project: dir, prompt: "noch einer" });
    await expect
      .poll(async () => (await sessions.get(record.id))?.status, { timeout: 15_000 })
      .toBe("idle");
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    const res = await app.inject({ method: "GET", url: `/api/statistics?since=${encodeURIComponent(tomorrow)}`, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(StatisticsReport.parse(res.json()).sessions).toEqual([]);
  });
});
