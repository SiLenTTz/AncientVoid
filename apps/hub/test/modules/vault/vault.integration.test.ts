import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { homedir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { basicFeatures } from "@ancientvoid/contracts";
import { EventStore, SessionManager, AdapterRegistry, HubDatabase, TokenService, SettingsStore } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import { createHubApp } from "../../../src/app.ts";

describe("vault routes (integration, EPIC-P49)", () => {
  let base: string;
  let vaultDir: string;
  let app: FastifyInstance;
  let token: string;
  let agentToken: string;

  async function buildApp(): Promise<FastifyInstance> {
    const hubDir = join(base, "hub");
    const db = new HubDatabase(join(hubDir, "hub.db"));
    const store = new EventStore(join(hubDir, "sessions"));
    const registry = new AdapterRegistry();
    registry.register("dummy", () => ({
      id: "dummy",
      version: "0.0.1",
      capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: false, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures({ followUp: false, interrupt: false }) }),
      async start(_spec, ctx) {
        return { sessionId: ctx.sessionId };
      },
      async steer() {
        return { ok: true };
      },
      async recover(sessionId) {
        return { sessionId };
      },
      async status() {
        return { state: "healthy" };
      },
      async stop() {},
    }));
    const sessions = new SessionManager(db, store, registry, new ProcessRunner());
    await sessions.recoverAll();
    const tokens = new TokenService(db);
    token = tokens.issue("mensch").token;
    agentToken = tokens.issue("agent:e2e").token;
    const built = await createHubApp({
      sessions,
      tokens,
      registry,
      auth: { tokens, enforceTailnetIdentity: false },
      store,
      settings: new SettingsStore(db),
      projectRoots: [base],
      dataDir: join(hubDir, "data"),
    });
    await built.listen({ port: 0, host: "127.0.0.1" });
    return built;
  }

  beforeAll(async () => {
    // Der Vault kanonisiert Pfade (P51); tmpdir kann ein Symlink sein (macOS /var → /private/var).
    base = await realpath(await mkdtemp(join(tmpdir(), "av-vault-int-")));
    vaultDir = join(base, "notizen");
    await mkdir(vaultDir);
    await mkdir(join(base, "hub", "data"), { recursive: true });
    await writeFile(join(vaultDir, "alt.md"), "# Alt\n");
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await rm(base, { recursive: true, force: true });
  });

  const human = { authorization: "" };
  const setAuth = () => {
    human.authorization = `Bearer ${token}`;
  };

  it("unkonfiguriert: state ehrlich, Listen 422, Browse zeigt Startpunkte", async () => {
    setAuth();
    const state = await app.inject({ method: "GET", url: "/api/vault/state", headers: human });
    expect(state.statusCode).toBe(200);
    expect(state.json()).toEqual({ configured: false, root: null, label: null });
    const list = await app.inject({ method: "GET", url: "/api/vault/files", headers: human });

    expect(list.statusCode).toBe(422);
    const browse = await app.inject({ method: "GET", url: "/api/vault/browse", headers: human });
    expect(browse.statusCode).toBe(200);
    const roots = browse.json().roots as { name: string; path: string }[];
    expect(roots.some((r) => r.path === base)).toBe(true);
    expect(roots.some((r) => r.path === homedir())).toBe(true);
  });

  it("Root-Wahl: Mensch darf, Agent bekam 403 auf alles", async () => {
    const put = await app.inject({ method: "PUT", url: "/api/vault/root", headers: human, payload: { path: vaultDir } });
    expect(put.statusCode).toBe(200);
    expect(put.json().label).toBe("notizen");
    const agent = { authorization: `Bearer ${agentToken}` };
    for (const [method, url] of [["GET", "/api/vault/state"], ["GET", "/api/vault/files"], ["POST", "/api/vault/files"], ["PUT", "/api/vault/root"]] as const) {
      const res = await app.inject(method === "GET" ? { method, url, headers: agent } : { method, url, headers: agent, payload: method === "POST" ? { name: "x" } : { path: vaultDir } });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it("Liste, Anlegen, Lesen, Schreiben mit Revision-Guard", async () => {
    const list = await app.inject({ method: "GET", url: "/api/vault/files", headers: human });
    expect(list.statusCode).toBe(200);
    expect(list.json().files.map((f: { path: string }) => f.path)).toEqual(["alt.md"]);
    const made = await app.inject({ method: "POST", url: "/api/vault/files", headers: human, payload: { name: "Neue Notiz" } });
    expect(made.statusCode).toBe(201);
    expect(made.json().path).toBe("Neue Notiz.md");
    const dup = await app.inject({ method: "POST", url: "/api/vault/files", headers: human, payload: { name: "Neue Notiz" } });
    expect(dup.statusCode).toBe(409);
    const read = await app.inject({ method: "GET", url: `/api/vault/file?path=${encodeURIComponent("Neue Notiz.md")}`, headers: human });
    expect(read.statusCode).toBe(200);
    const rev = read.json().revision;
    const save = await app.inject({ method: "PUT", url: `/api/vault/file?path=${encodeURIComponent("Neue Notiz.md")}&rev=${rev}`, headers: human, payload: { text: "# Besser\n" } });
    expect(save.statusCode).toBe(200);
    const stale = await app.inject({ method: "PUT", url: `/api/vault/file?path=${encodeURIComponent("Neue Notiz.md")}&rev=${rev}`, headers: human, payload: { text: "# Veraltet\n" } });
    expect(stale.statusCode).toBe(409);
    const again = await app.inject({ method: "GET", url: `/api/vault/file?path=${encodeURIComponent("Neue Notiz.md")}`, headers: human });
    expect(again.json().text).toBe("# Besser\n");
  });

  it("vault=1-Ziel der Code-Routen: Dateiansicht und Suche im Vault-Root", async () => {
    const meta = await app.inject({ method: "GET", url: `/api/code/meta?vault=1&path=${encodeURIComponent("alt.md")}`, headers: human });
    expect(meta.statusCode).toBe(200);
    expect(meta.json().language).toBe("markdown");
    const range = await app.inject({ method: "GET", url: `/api/code/range?vault=1&path=${encodeURIComponent("alt.md")}&offset=0&rev=${meta.json().revision}&as=text`, headers: human });
    expect(range.statusCode).toBe(200);
    expect(range.json().text).toContain("# Alt");
  });

  it("Traversal über die API blockiert", async () => {
    const escape = await app.inject({ method: "GET", url: `/api/vault/file?path=${encodeURIComponent("../../etc/passwd")}`, headers: human });
    expect(escape.statusCode).toBe(422);
  });

  it("P51: externer Root über bestehende API, Symlink-Liste und unveränderte Agenten-403", async () => {
    const outside = await realpath(await mkdtemp(join(tmpdir(), "av-vault-external-")));
    try {
      const target = join(outside, "z-notizen");
      await mkdir(target);
      await writeFile(join(target, "test.md"), "# Extern\n");
      await symlink(target, join(outside, "a-link"));
      await symlink(outside, join(target, "zyklus"));
      const put = await app.inject({ method: "PUT", url: "/api/vault/root", headers: human, payload: { path: outside } });
      expect(put.statusCode).toBe(200);
      expect(put.json().root).toBe(outside);
      const start = await app.inject({ method: "GET", url: "/api/vault/browse", headers: human });
      expect(start.json().roots).toContainEqual({ name: outside.split("/").at(-1), path: outside });
      const list = await app.inject({ method: "GET", url: "/api/vault/files", headers: human });
      expect(list.statusCode).toBe(200);
      expect(list.json().files.map((f: { path: string }) => f.path)).toEqual(["a-link/test.md"]);
      const read = await app.inject({ method: "GET", url: "/api/vault/file?path=a-link/test.md", headers: human });
      expect(read.statusCode).toBe(200);
      expect(read.json().text).toBe("# Extern\n");
      const agent = { authorization: `Bearer ${agentToken}` };
      for (const url of ["/api/vault/browse", "/api/vault/files", "/api/vault/file?path=a-link/test.md"]) {
        expect((await app.inject({ method: "GET", url, headers: agent })).statusCode).toBe(403);
      }
      const agentPut = await app.inject({ method: "PUT", url: "/api/vault/root", headers: agent, payload: { path: base } });
      expect(agentPut.statusCode).toBe(403);
      await symlink(join(base, "hub", "data"), join(outside, "data-link"));
      const denied = await app.inject({ method: "PUT", url: "/api/vault/root", headers: human, payload: { path: join(outside, "data-link") } });
      expect(denied.statusCode).toBe(422);
      expect(denied.json().error).toMatch(/Datenverzeichnis/);
      const state = await app.inject({ method: "GET", url: "/api/vault/state", headers: human });
      expect(state.json().root).toBe(outside);
    } finally {
      await app.inject({ method: "PUT", url: "/api/vault/root", headers: human, payload: { path: vaultDir } });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
