import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, EventStore, HubDatabase, ProjectTrustStore, SessionManager, TokenService } from "@ancientvoid/core";
import { createAdapter as createDummy } from "@ancientvoid/adapter-dummy";
import { ProcessRunner } from "@ancientvoid/workers";
import type { FastifyInstance } from "fastify";
import { createHubApp } from "../../../src/app.ts";

/**
 * BUG-0186: Ferndiagnose — das Geraet meldet Fensterwinkel, Anzeigemodus, Manifest und
 * seinen Build-Stempel. Der Hub nimmt nur begrenzte Berichte an und protokolliert sie;
 * er erfindt nichts und speichert nichts dauerhaft (K7).
 */
describe("client-report routes (BUG-0186)", () => {
  let dir: string;
  let app: FastifyInstance;
  let token: string;

  const auth = () => ({ authorization: `Bearer ${token}` });
  const post = (url: string, payload: unknown, withToken = true) =>
    app.inject({ method: "POST", url, headers: withToken ? auth() : {}, payload: payload as object });

  const bericht = {
    kind: "orientation",
    angle: 270,
    how: "nicht-versucht",
    detail: "Stand neu geprueft",
    displayMode: "standalone",
    manifestOrientation: "any",
    width: 970,
    height: 796,
    devicePixelRatio: 2.25,
    platform: "Android",
    build: "763d7e44",
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-client-report-"));
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 1, autoStopAfterEvents: 0 });
    const tokens = new TokenService(db);
    const sessions = new SessionManager(db, new EventStore(join(dir, "data")), registry, new ProcessRunner());
    app = await createHubApp({
      sessions,
      tokens,
      registry,
      auth: { tokens, enforceTailnetIdentity: false },
      projectRoots: [dir],
      dataDir: join(dir, "data"),
      trust: new ProjectTrustStore(db),
    });
    token = tokens.issue("handy").token;
  });

  it("nimmt einen vollen Bericht an (202) — inklusive Build-Stempel", async () => {
    const res = await post("/api/diagnostics/client-report", bericht);
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ logged: true });
  });

  it("lehnt einen unbekannten Berichtstyp ab (400)", async () => {
    const res = await post("/api/diagnostics/client-report", { ...bericht, kind: "akku" });
    expect(res.statusCode).toBe(400);
  });

  it("lehnt ein uebergrosses Detailfeld ab (400)", async () => {
    const res = await post("/api/diagnostics/client-report", { ...bericht, detail: "x".repeat(201) });
    expect(res.statusCode).toBe(400);
  });

  it("lehnt einen uebergrossen Build-Stempel ab (400)", async () => {
    const res = await post("/api/diagnostics/client-report", { ...bericht, build: "b".repeat(41) });
    expect(res.statusCode).toBe(400);
  });

  it("verlangt ein Geraet, auch fuer den Bericht (401)", async () => {
    const res = await post("/api/diagnostics/client-report", bericht, false);
    expect(res.statusCode).toBe(401);
  });
});
