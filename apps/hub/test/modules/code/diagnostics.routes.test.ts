import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync, strToU8 } from "fflate";
import { AdapterRegistry, EventStore, HubDatabase, ProjectTrustStore, SessionManager, TokenService } from "@ancientvoid/core";
import { isFleetRoutable } from "@ancientvoid/contracts";
import { createAdapter as createDummy } from "@ancientvoid/adapter-dummy";
import { ProcessRunner } from "@ancientvoid/workers";
import type { FastifyInstance } from "fastify";
import { createHubApp } from "../../../src/app.ts";

/** EPIC-P46 T46.6–T46.8 (ADR-0058): Zeile/Suche/Archiv/Office, Diagnose + Freigabe, Datei-Feedback. */
describe("file viewer + diagnostics routes (EPIC-P46)", () => {
  let dir: string;
  let project: string;
  let app: FastifyInstance;
  let sessions: SessionManager;
  let token: string;

  const auth = () => ({ authorization: `Bearer ${token}` });
  const get = (url: string) => app.inject({ method: "GET", url, headers: auth() });
  const post = (url: string, payload: unknown = {}) => app.inject({ method: "POST", url, headers: auth(), payload: payload as object });
  const q = (path: string, extra = "") => `project=${encodeURIComponent(project)}&path=${encodeURIComponent(path)}${extra}`;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-diag-routes-"));
    project = join(dir, "proj");
    await mkdir(project, { recursive: true });
    await writeFile(join(project, "a.json"), '{\n  "a": 1,\n}\n');
    await writeFile(join(project, "notes.txt"), "eins\nzwei\ndrei NADEL\n");
    await writeFile(join(project, "a.zip"), zipSync({ "x.txt": strToU8("hallo") }));
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 1, autoStopAfterEvents: 0 });
    const tokens = new TokenService(db);
    sessions = new SessionManager(db, new EventStore(join(dir, "data")), registry, new ProcessRunner());
    app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false }, projectRoots: [dir], dataDir: join(dir, "data"), trust: new ProjectTrustStore(db) });
    token = tokens.issue("pixel").token;
  });

  afterEach(async () => {
    await sessions.shutdown();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("Diagnose braucht Auth und läuft nur per POST", async () => {
    expect((await app.inject({ method: "POST", url: `/api/diagnostics/run?${q("a.json")}` })).statusCode).toBe(401);
  });

  it("JSON-Fehler wird gemeldet; Ergebnis trägt die Revision der Datei", async () => {
    const res = await post(`/api/diagnostics/run?${q("a.json")}`);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { state: string; revision: string };
    expect(body.state).toBe("errors");
    const meta = (await get(`/api/code/meta?${q("a.json")}`)).json() as { revision: string };
    expect(body.revision).toBe(meta.revision);
  });

  it("Freigabe: Standard nicht freigegeben, setzen und lesen; ungültiger Body 400", async () => {
    expect(((await get(`/api/diagnostics/trust?${q("a.json")}`)).json() as { trusted: boolean }).trusted).toBe(false);
    expect((await post(`/api/diagnostics/trust?${q("a.json")}`, { trusted: "ja" })).statusCode).toBe(400);
    expect((await post(`/api/diagnostics/trust?${q("a.json")}`, { trusted: true })).statusCode).toBe(200);
    expect(((await get(`/api/diagnostics/trust?${q("a.json")}`)).json() as { trusted: boolean }).trusted).toBe(true);
  });

  it("line/find liefern Byte-Offset, Zeile und Spalte", async () => {
    const meta = (await get(`/api/code/meta?${q("notes.txt")}`)).json() as { revision: string };
    const line = await get(`/api/code/line?${q("notes.txt", "&line=2")}`);
    expect(line.statusCode).toBe(200);
    const found = await get(`/api/code/find?${q("notes.txt", `&q=nadel&rev=${meta.revision}`)}`);
    expect(found.statusCode).toBe(200);
    expect(found.json()).toMatchObject({ found: true, line: 3 });
  });

  it("Archiv-Liste ohne Entpacken; Pfad außerhalb → 404", async () => {
    const res = await get(`/api/code/archive?${q("a.zip")}`);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { entries: { name: string }[] }).entries[0]?.name).toBe("x.txt");
    expect((await get(`/api/code/archive?${q("../x.zip")}`)).statusCode).toBeGreaterThanOrEqual(400);
  });

  it("Flotte: Lese-Endpunkte routbar, Diagnose und Aktionen nicht", () => {
    for (const p of ["tree", "meta", "range", "raw", "find", "line", "archive", "office"]) expect(isFleetRoutable(`/api/code/${p}?x=1`)).toBe(true);
    expect(isFleetRoutable("/api/diagnostics/run")).toBe(false);
    expect(isFleetRoutable("/api/code/actions/run")).toBe(false);
  });
});
