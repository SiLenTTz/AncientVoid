import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, EventStore, HubDatabase, SessionManager, TokenService } from "@ancientvoid/core";
import { createAdapter as createDummy } from "@ancientvoid/adapter-dummy";
import { ProcessRunner } from "@ancientvoid/workers";
import type { FastifyInstance } from "fastify";
import { createHubApp } from "../../../src/app.ts";

/** EPIC-P46 (ADR-0058): Tree, Meta, Range und Raw über HTTP — Auth, Containment, Revision, Range-Header. */
describe("explorer routes (EPIC-P46)", () => {
  let dir: string;
  let project: string;
  let app: FastifyInstance;
  let sessions: SessionManager;
  let token: string;

  const get = (url: string, headers: Record<string, string> = {}, auth = true) =>
    app.inject({ method: "GET", url, headers: { ...(auth ? { authorization: `Bearer ${token}` } : {}), ...headers } });
  const q = (path: string, extra = "") => `project=${encodeURIComponent(project)}&path=${encodeURIComponent(path)}${extra}`;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-explorer-routes-"));
    project = join(dir, "proj");
    await mkdir(join(project, "src"), { recursive: true });
    await writeFile(join(project, "src/app.ts"), "export const x = 1;\n");
    await writeFile(join(project, "bild.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 4, 5]));
    await writeFile(join(dir, "geheim.txt"), "nicht im Projekt");
    await symlink(dir, join(project, "aus"));
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: project });
    execFileSync("git", ["add", "-A"], { cwd: project });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: project });
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 1, autoStopAfterEvents: 0 });
    const tokens = new TokenService(db);
    sessions = new SessionManager(db, new EventStore(join(dir, "data")), registry, new ProcessRunner());
    app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false }, projectRoots: [dir], dataDir: join(dir, "data") });
    token = tokens.issue("pixel").token;
  });

  afterEach(async () => {
    await sessions.shutdown();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("alle Endpunkte verlangen Auth", async () => {
    for (const route of ["tree", "meta", "range", "raw"]) {
      expect((await get(`/api/code/${route}?${q("src/app.ts", "&as=text")}`, {}, false)).statusCode).toBe(401);
    }
  });

  it("Tree: lazy Seite mit Gitstatus; Ausbruchs-Link gesperrt; ../ und fremde Projekte abgewiesen", async () => {
    const res = await get(`/api/code/tree?${q("")}`);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { entries: { name: string; blocked: string | null; kind: string }[]; identity: { kind: string } };
    expect(body.identity.kind).toBe("project");
    expect(body.entries.map((e) => e.name)).toEqual(expect.arrayContaining(["src", "bild.png", "aus", ".git"]));
    expect(body.entries.find((e) => e.name === "aus")?.blocked).toMatch(/heraus/);
    expect((await get(`/api/code/tree?${q("../")}`)).statusCode).toBe(404);
    expect((await get(`/api/code/tree?project=${encodeURIComponent(tmpdir())}`)).statusCode).toBe(422);
  });

  it("Meta + Range: Revision gebunden, falsche Revision → 409, Ausbruch → 404", async () => {
    const meta = (await get(`/api/code/meta?${q("src/app.ts")}`)).json() as { revision: string; family: string; bytes: number };
    expect(meta).toMatchObject({ family: "text", bytes: 20 });
    const ok = await get(`/api/code/range?${q("src/app.ts", `&as=text&rev=${meta.revision}`)}`);
    expect(ok.json()).toMatchObject({ text: "export const x = 1;\n", eof: true, nextOffset: null });
    const stale = await get(`/api/code/range?${q("src/app.ts", "&as=text&rev=deadbeef")}`);
    expect(stale.statusCode).toBe(409);
    expect((await get(`/api/code/range?${q("aus/geheim.txt", "&as=text")}`)).statusCode).toBe(404);
    expect((await get(`/api/code/range?${q("src/app.ts")}`)).statusCode).toBe(400);
  });

  it("Raw: Originalbytes mit Range (206), nosniff + Sandbox-CSP; Download als attachment; kein .git", async () => {
    const full = await get(`/api/code/raw?${q("bild.png")}`);
    expect(full.statusCode).toBe(200);
    expect(full.rawPayload.length).toBe(10);
    expect(full.headers["content-type"]).toBe("image/png");
    expect(full.headers["x-content-type-options"]).toBe("nosniff");
    expect(String(full.headers["content-security-policy"])).toContain("sandbox");
    const part = await get(`/api/code/raw?${q("bild.png")}`, { range: "bytes=4-7" });
    expect(part.statusCode).toBe(206);
    expect(part.headers["content-range"]).toBe("bytes 4-7/10");
    expect([...part.rawPayload]).toEqual([0, 1, 2, 3]);
    expect((await get(`/api/code/raw?${q("bild.png")}`, { range: "bytes=50-60" })).statusCode).toBe(416);
    const dl = await get(`/api/code/raw?${q("src/app.ts", "&download=1")}`);
    expect(String(dl.headers["content-disposition"])).toMatch(/^attachment/);
    expect(dl.headers["content-type"]).toBe("application/octet-stream");
    expect((await get(`/api/code/raw?${q(".git/config")}`)).statusCode).toBe(404);
  });
});
