import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { AdapterRegistry, EventStore, HubDatabase, SessionManager, TokenService } from "@ancientvoid/core";
import { basicFeatures, type Adapter } from "@ancientvoid/contracts";
import { ProcessRunner } from "@ancientvoid/workers";
import { createHubApp } from "../../../src/app.ts";

/**
 * BUG-0184 / ADR-0084: GET /api/sessions/:id/tokens. Der Adapter meldet drei
 * Aufrufe mit demselben 150k-Kontext und ein geschätztes Ereignis — die Route
 * muss „erzeugt“ (600) und „verarbeitet“ (der Kontext-Summen) getrennt ausweisen.
 */
describe("hub route — Token-Bilanz (BUG-0184)", () => {
  let dir: string;
  let app: FastifyInstance;
  let token: string;

  const adapter: Adapter = {
    id: "zaehler",
    version: "0.0.1",
    capabilities: () => ({
      reasoning: false,
      tools: false,
      cost: false,
      steer: false,
      usage: true,
      nativeDiscovery: "none",
      nativeResume: "none",
      features: basicFeatures({}),
    }),
    async start(_spec, ctx) {
      for (const [i, out] of [100, 200, 300].entries()) {
        ctx.emit({
          type: "system",
          summary: `zaehler: usage #${i + 1}`,
          payload: { kind: "zaehler.usage", usage: { input: 150_000, output: out } },
          tokensEst: 150_000 + out,
        });
      }
      ctx.emit({ type: "assistant", summary: "ein Text", payload: {}, tokensEst: 900, tokensSource: "estimated" });
      return { sessionId: ctx.sessionId };
    },
    async steer() {
      return { ok: true };
    },
    async status() {
      return { state: "healthy" };
    },
    async stop() {},
  };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-token-totals-"));
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("zaehler", () => adapter);
    const sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner(), undefined, undefined, undefined, null, [], {}, undefined, "auto");
    const tokens = new TokenService(db);
    token = tokens.issue("test-device").token;
    app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false } });
  });

  afterAll(async () => {
    await app.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  });

  const get = (url: string) => app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });

  it("weist Erzeugtes und Verarbeitetes getrennt aus", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { authorization: `Bearer ${token}` },
      payload: { adapter: "zaehler", project: dir, prompt: "drei Aufrufe" },
    });
    expect(created.statusCode).toBe(201);
    const { id } = created.json() as { id: string };

    await expect
      .poll(async () => ((await get(`/api/sessions/${id}/tokens`)).json() as { usageEvents: number }).usageEvents)
      .toBe(4);

    const res = await get(`/api/sessions/${id}/tokens`);
    expect(res.statusCode).toBe(200);
    const t = res.json() as {
      generated: number | null;
      processed: number | null;
      contextFill: number | null;
      cacheRead: number | null;
      usageEvents: number;
      estimated: boolean;
      lastSeq: number;
    };
    // Der Agent hat 600 Tokens geschrieben — nicht 451.500.
    expect(t.generated).toBe(600);
    // Verarbeitet ist die Summe der Aufrufgroessen (ADR-0006), inkl. des geschaetzten Events.
    expect(t.processed).toBe(3 * 150_000 + 600 + 900);
    expect(t.processed ?? 0).toBeGreaterThan((t.generated ?? 0) * 100);
    expect(t.contextFill).toBe(150_000);
    expect(t.cacheRead).toBeNull(); // dieser Adapter trennt keinen Cache
    expect(t.usageEvents).toBe(4); // nur diese vier tragen Zahlen, Lifecycle-Ereignisse nicht
    expect(t.estimated).toBe(true);
    expect(t.lastSeq).toBeGreaterThanOrEqual(4);
  });

  it("unbekannte Session ist ein 404, nicht eine Null-Bilanz", async () => {
    const res = await get("/api/sessions/gibt-es-nicht/tokens");
    expect(res.statusCode).toBe(404);
  });
});
