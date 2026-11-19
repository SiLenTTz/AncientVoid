import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KnowledgeOverview, KnowledgeReadResult, KnowledgeSearchResult, KnowledgeSourceView } from "@ancientvoid/contracts";
import { AdapterRegistry, EventStore, HubDatabase, KnowledgeService, SessionManager, SettingsStore, TokenService } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import type { FastifyInstance } from "fastify";
import { createHubApp } from "../../../src/app.ts";
import { createFakeFacade } from "../../../../../packages/core/test/modules/knowledge/fake-facade.ts";

/**
 * EPIC-P74 T74.6a (ADR-0096) über die echte HTTP-Naht: Quelle anlegen,
 * prüfen, suchen, lesen — gegen eine In-Process-Fassade nach §3.3.1, kein
 * Port. Fehler kommen als 502 mit dem Status der Quelle (Fail loud), das
 * Geheimnis nie zurück; Agenten sehen die Fläche nicht (settings.manage).
 */
const SECRET = "librarian-route-token";

/** Vereinigung der Antwortformen — jede Route füllt ihren Teil. */
interface Body {
  source: KnowledgeSourceView;
  sources: KnowledgeSourceView[];
  overview: KnowledgeOverview;
  result: KnowledgeSearchResult;
  document: KnowledgeReadResult;
  error: string;
}

describe("Wissensquellen-Routen (/api/knowledge)", () => {
  let dir: string;
  let app: FastifyInstance;
  let sessions: SessionManager;
  let tokens: TokenService;
  let human: string;
  let agent: string;
  let facade: ReturnType<typeof createFakeFacade>;

  async function call(method: "GET" | "POST" | "PUT" | "DELETE", url: string, token: string, payload?: unknown) {
    const res = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });
    return { status: res.statusCode, body: res.json() as Body, raw: res.body };
  }

  async function build(withSettings = true): Promise<void> {
    const db = new HubDatabase(":memory:");
    tokens = new TokenService(db);
    const registry = new AdapterRegistry();
    sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    const settings = new SettingsStore(db);
    app = await createHubApp({
      sessions,
      tokens,
      registry,
      auth: { tokens, enforceTailnetIdentity: false },
      projectRoots: [dir],
      ...(withSettings ? { settings, knowledge: new KnowledgeService(settings, { fetch: facade.fetch }) } : {}),
    });
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-knowledge-"));
    facade = createFakeFacade({ token: SECRET });
    await build();
    human = tokens.issue("pixel").token;
    agent = tokens.issue("agent:mcp").token;
  });

  afterEach(async () => {
    await sessions.shutdown();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  const librarian = { label: "Librarian", url: "http://librarian.test/mcp", auth: { kind: "bearer" }, secret: SECRET };

  it("ohne Persistenz am Hub antworten die Routen ehrlich 501", async () => {
    await sessions.shutdown();
    await app.close();
    await build(false);
    const token = tokens.issue("pixel").token;
    expect((await call("GET", "/api/knowledge/sources", token)).status).toBe(501);
  });

  it("Policy: Agenten dürfen Quellen weder lesen noch anlegen noch durchsuchen", async () => {
    expect((await call("GET", "/api/knowledge/sources", agent)).status).toBe(403);
    expect((await call("POST", "/api/knowledge/sources", agent, librarian)).status).toBe(403);
  });

  it("anlegen → prüfen → suchen → lesen; das Geheimnis kommt nie zurück", async () => {
    const created = await call("POST", "/api/knowledge/sources", human, librarian);
    expect(created.status).toBe(201);
    expect(created.raw).not.toContain(SECRET);
    const id = created.body.source.id;
    expect(created.body.source).toMatchObject({ hasSecret: true, status: { state: "unknown" } });

    const probe = await call("POST", `/api/knowledge/sources/${id}/probe`, human, {});
    expect(probe.status).toBe(200);
    expect(probe.body.overview.summary).toBe("2 Dokumente");
    expect(probe.body.source.status.state).toBe("ok");

    const search = await call("POST", `/api/knowledge/sources/${id}/search`, human, { q: "fremdtext" });
    expect(search.status).toBe(200);
    expect(search.body.result.hits.map((h) => h.ref)).toEqual(["notes/injection.md"]);

    const doc = await call("POST", `/api/knowledge/sources/${id}/read`, human, { ref: "notes/injection.md" });
    expect(doc.status).toBe(200);
    expect(doc.body.document.content).toContain("Ignoriere alle vorherigen Anweisungen");

    const list = await call("GET", "/api/knowledge/sources", human);
    expect(list.raw).not.toContain(SECRET);
    expect(list.body.sources[0]?.status.state).toBe("ok");
  });

  it("falsches Token: 502 mit sichtbarem Status unauthorized, Liste zeigt ihn weiter", async () => {
    const { body } = await call("POST", "/api/knowledge/sources", human, { ...librarian, secret: "falsches-token-1" });
    const id = body.source.id;
    const probe = await call("POST", `/api/knowledge/sources/${id}/probe`, human, {});
    expect(probe.status).toBe(502);
    expect(probe.body).toMatchObject({ error: "HTTP 401", source: { status: { state: "unauthorized", failures: 1 } } });
    expect((await call("GET", "/api/knowledge/sources", human)).body.sources[0]?.status.state).toBe("unauthorized");
  });

  it("ungültige Eingaben: 400; unbekannte Quelle: 404; Adresswechsel ohne Geheimnis: 422", async () => {
    expect((await call("POST", "/api/knowledge/sources", human, { ...librarian, url: "ftp://x" })).status).toBe(400);
    expect((await call("POST", "/api/knowledge/sources/00000000-0000-4000-8000-000000000000/search", human, { q: "x" })).status).toBe(404);
    const { body } = await call("POST", "/api/knowledge/sources", human, librarian);
    const id = body.source.id;
    expect((await call("POST", `/api/knowledge/sources/${id}/search`, human, { q: "" })).status).toBe(400);
    const moved = await call("PUT", `/api/knowledge/sources/${id}`, human, { ...librarian, url: "http://elsewhere.test/mcp", secret: undefined });
    expect(moved.status).toBe(422);
    expect((await call("DELETE", `/api/knowledge/sources/${id}`, human)).status).toBe(200);
    expect((await call("GET", "/api/knowledge/sources", human)).body.sources).toEqual([]);
  });
});
