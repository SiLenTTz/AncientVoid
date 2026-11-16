import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { EndpointProbe as EndpointProbeView } from "@ancientvoid/contracts";
import { AdapterRegistry, EventStore, HubDatabase, SessionManager, SettingsStore, TokenService } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import type { FastifyInstance } from "fastify";
import { createHubApp } from "../../../src/app.ts";

/**
 * Verbindungs-Registry über die echte HTTP-Naht (createHubApp + inject):
 * VoidWarden-Verbindungen mit einmalig sichtbarem read-only-Token, Endpoint-
 * Registry mit Hash-only-Schlüsseln, Erreichbarkeits-Check gegen einen lokalen
 * Server, Policy settings.manage (Agenten: deny).
 */
describe("Verbindungs-Registry (Optionen: VoidWarden + Endpoints)", () => {
  let dir: string;
  let app: FastifyInstance;
  let sessions: SessionManager;
  let tokens: TokenService;
  let human: string;
  let agent: string;

  async function call(method: "GET" | "POST" | "PUT" | "DELETE", url: string, token: string, payload?: unknown) {
    const res = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });
    return { status: res.statusCode, body: res.json() as Record<string, unknown> };
  }

  async function build(withSettings = true): Promise<void> {
    const db = new HubDatabase(":memory:");
    tokens = new TokenService(db);
    const registry = new AdapterRegistry();
    sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false }, projectRoots: [dir], ...(withSettings ? { settings: new SettingsStore(db) } : {}) });
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-connections-"));
    await build();
    human = tokens.issue("pixel").token;
    agent = tokens.issue("agent:mcp").token;
  });

  afterEach(async () => {
    await sessions.shutdown();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("ohne Persistenz am Hub antworten alle Verbindungs-Routen ehrlich 501", async () => {
    await sessions.shutdown();
    await app.close();
    await build(false);
    const token = tokens.issue("pixel").token;
    expect((await call("GET", "/api/connections", token)).status).toBe(501);
    expect((await call("POST", "/api/connections/endpoints", token, { name: "x", kind: "llm", baseUrl: "http://x/v1", models: [] })).status).toBe(501);
  });

  it("Policy: Agenten und Displays dürfen die Registry weder lesen noch schreiben (settings.manage)", async () => {
    expect((await call("GET", "/api/connections", agent)).status).toBe(403);
    expect((await call("POST", "/api/connections/voidwarden", agent, { name: "Nyx" })).status).toBe(403);
    const display = tokens.issue("display:kiosk").token;
    expect((await call("GET", "/api/connections", display)).status).toBe(403);
  });

  it("VoidWarden: Token einmalig sichtbar, liest read-only, Status = letzte Meldung; Erneuern legt still", async () => {
    const created = await call("POST", "/api/connections/voidwarden", human, { name: "Nyx Board", endpoint: "http://pixel:8080" });
    expect(created.status).toBe(201);
    const token = created.body.token as string;
    expect(typeof token).toBe("string");
    expect(created.body.connection).toMatchObject({ name: "Nyx Board", endpoint: "http://pixel:8080", tokenLabel: expect.stringMatching(/^agent:vw-/), lastSeenAt: null });

    // Das Token ist ein echtes: lesen ja …
    expect((await app.inject({ method: "GET", url: "/api/sessions", headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200);
    // … und die Meldung macht sich als Status bemerkbar (last_used_at).
    const afterUse = (await call("GET", "/api/connections", human)).body.voidwarden as { lastSeenAt: string | null }[];
    expect(afterUse[0]!.lastSeenAt).not.toBeNull();
    // … aber token-verwalten nein (settings/tokens.manage: Agenten deny).
    expect((await app.inject({ method: "POST", url: "/api/tokens", headers: { authorization: `Bearer ${token}` }, payload: { label: "böse" } as object })).statusCode).toBe(403);

    // Nie wieder sichtbar: Listen und erneutes Abfragen tragen kein Token.
    expect(JSON.stringify((await call("GET", "/api/connections", human)).body)).not.toContain(token);

    const rotated = await call("PUT", `/api/connections/voidwarden/${(created.body.connection as { id: string }).id}`, human, { name: "Nyx Board", rotate: true });
    expect(rotated.status).toBe(200);
    const fresh = rotated.body.token as string;
    expect(fresh).not.toBe(token);
    // Altes Token ist tot, das neue liest.
    expect((await app.inject({ method: "GET", url: "/api/sessions", headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/sessions", headers: { authorization: `Bearer ${fresh}` } })).statusCode).toBe(200);
  });

  it("VoidWarden: bearbeiten und löschen; Löschen zieht das Token zurück; Obergrenze 16", async () => {
    const a = await call("POST", "/api/connections/voidwarden", human, { name: "Eins" });
    const idA = (a.body.connection as { id: string }).id;
    expect((await call("PUT", `/api/connections/voidwarden/${idA}`, human, { name: "Zwei", endpoint: "http://zwei:9" })).body.connection).toMatchObject({ id: idA, name: "Zwei", endpoint: "http://zwei:9" });
    expect((await call("PUT", "/api/connections/voidwarden/00000000-0000-4000-8000-000000000000", human, { name: "X" })).status).toBe(404);

    for (let i = 0; i < 15; i++) await call("POST", "/api/connections/voidwarden", human, { name: `Füllung ${i}` });
    expect((await call("POST", "/api/connections/voidwarden", human, { name: "Zu viel" })).status).toBe(422);

    const tokenA = a.body.token as string;
    expect((await app.inject({ method: "GET", url: "/api/sessions", headers: { authorization: `Bearer ${tokenA}` } })).statusCode).toBe(200);
    expect((await call("DELETE", `/api/connections/voidwarden/${idA}`, human)).body).toEqual({ ok: true });
    expect((await app.inject({ method: "GET", url: "/api/sessions", headers: { authorization: `Bearer ${tokenA}` } })).statusCode).toBe(401);
    expect((await call("DELETE", `/api/connections/voidwarden/${idA}`, human)).status).toBe(404);
    expect(((await call("GET", "/api/connections", human)).body.voidwarden as unknown[])).toHaveLength(15);
  });

  it("Endpoints: Validierung, Hash-only-Schlüssel, bearbeiten, löschen; Obergrenze 32", async () => {
    expect((await call("POST", "/api/connections/endpoints", human, { name: "X", kind: "llm", baseUrl: "file:///etc/passwd", models: [] })).status).toBe(400);
    expect((await call("POST", "/api/connections/endpoints", human, { name: "X", kind: "telepathie", baseUrl: "http://x/v1", models: [] })).status).toBe(400);

    const created = await call("POST", "/api/connections/endpoints", human, { name: "Gpubox", kind: "llm", baseUrl: "http://100.64.0.10:8100/v1", apiKey: "sk-e2e-streng-geheim", models: ["halogen-qwen", "halogen-qwen"] });
    expect(created.status).toBe(201);
    const id = (created.body.endpoint as { id: string }).id;
    expect(created.body.endpoint).toMatchObject({ name: "Gpubox", kind: "llm", baseUrl: "http://100.64.0.10:8100/v1", hasKey: true, models: ["halogen-qwen"], probe: null });
    // Kein Schlüssel-Material in irgendeiner Antwort — nur hasKey.
    expect(JSON.stringify(created.body)).not.toContain("sk-e2e-streng-geheim");
    const raw = JSON.stringify((await call("GET", "/api/connections", human)).body);
    expect(raw).not.toContain("sk-e2e-streng-geheim");
    expect(raw).not.toContain("apiKeyHash");

    // weglassen behält, null entfernt
    expect((await call("PUT", `/api/connections/endpoints/${id}`, human, { name: "Gpubox", kind: "llm", baseUrl: "http://100.64.0.10:8100/v1", models: ["halogen-qwen"] })).body.endpoint).toMatchObject({ hasKey: true });
    expect((await call("PUT", `/api/connections/endpoints/${id}`, human, { name: "Gpubox", kind: "image", baseUrl: "http://100.64.0.10:8100/v1", apiKey: null, models: [] })).body.endpoint).toMatchObject({ hasKey: false, kind: "image" });

    expect((await call("DELETE", `/api/connections/endpoints/${id}`, human)).body).toEqual({ ok: true });
    expect((await call("PUT", `/api/connections/endpoints/${id}`, human, { name: "X", kind: "llm", baseUrl: "http://x/v1", models: [] })).status).toBe(404);

    for (let i = 0; i < 32; i++) await call("POST", "/api/connections/endpoints", human, { name: `E${i}`, kind: "other", baseUrl: `http://e${i}/v1`, models: [] });
    expect((await call("POST", "/api/connections/endpoints", human, { name: "Zu viel", kind: "other", baseUrl: "http://x/v1", models: [] })).status).toBe(422);
  });

  it("Probe: jede HTTP-Antwort zählt als erreichbar, Netzwerkfehler nicht; Ergebnis bleibt gespeichert", async () => {
    const server: Server = createServer((_req, res) => {
      res.statusCode = 401;
      res.end("no");
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const port = (server.address() as { port: number }).port;
    // Ein gerade freigegebener Port: garantiert niemand lauscht — ECONNREFUSED statt Fetch-Spec-„bad port“.
    const closedPort = await new Promise<number>((resolvePort) => {
      const probe = createServer();
      probe.listen(0, "127.0.0.1", () => {
        const p = (probe.address() as { port: number }).port;
        probe.close(() => resolvePort(p));
      });
    });
    try {
      const up = await call("POST", "/api/connections/endpoints", human, { name: "Lokal", kind: "llm", baseUrl: `http://127.0.0.1:${port}/v1`, models: [] });
      const upId = (up.body.endpoint as { id: string }).id;
      const probed = await call("POST", `/api/connections/endpoints/${upId}/probe`, human);
      expect((probed.body.endpoint as { probe: EndpointProbeView }).probe).toMatchObject({ ok: true, httpStatus: 401, detail: null });

      const down = await call("POST", "/api/connections/endpoints", human, { name: "Tot", kind: "other", baseUrl: `http://127.0.0.1:${closedPort}/v1`, models: [] });
      const downId = (down.body.endpoint as { id: string }).id;
      const failed = await call("POST", `/api/connections/endpoints/${downId}/probe`, human);
      expect((failed.body.endpoint as { probe: EndpointProbeView }).probe).toMatchObject({ ok: false, httpStatus: null });
      expect((failed.body.endpoint as { probe: EndpointProbeView }).probe.detail).toMatch(/ECONNREFUSED|Zeitüberschreitung/);

      // Nach dem Prüfen steht das Ergebnis auch in der Liste (Persistenz über Requests hinweg).
      const list = (await call("GET", "/api/connections", human)).body.endpoints as { id: string; probe: { ok: boolean } | null }[];
      expect(list.find((e) => e.id === upId)?.probe).toMatchObject({ ok: true, httpStatus: 401 });
      expect(list.find((e) => e.id === downId)?.probe?.ok).toBe(false);
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });
});
