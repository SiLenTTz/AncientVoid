import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readdirSync, readFileSync, statSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { EventStore, HubDatabase, LoopRegistry, SessionManager, AdapterRegistry, TokenService, loopAsAdapter, WorktreeManager } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import { createAdapter as createDummy } from "@ancientvoid/adapter-dummy";
import { createLoopConnector } from "@ancientvoid/loop-securesight-factory";
import { createHubApp } from "../src/app.ts";
import { standIn } from "../../../e2e/support/stand-in.ts";

/**
 * EPIC-P26 T26.5 / ADR-0043: `POST /api/factory/start` legt Treiber (Claude,
 * erster Prompt `/factory`) und Beobachter (Loop project-Modus) verknüpft an.
 * Die Treiber sind Dummys unter den produktiven Namen claude/maki;
 * Auswahl, Skill-Auflösung, Workdir und HTTP-Vertrag bleiben echt.
 */
const STAND_IN = standIn("factory");

describe("Factory-Start (T26.5, ADR-0043)", () => {
  let dir: string;
  let app: FastifyInstance;
  let token: string;
  let tokens: TokenService;
  let project: string;
  let sessions: SessionManager;
  let makiPrompt: string | undefined;

  beforeAll(async () => {
    // Projektpfade werden kanonisiert; tmpdir kann ein Symlink sein (macOS /var → /private/var).
    dir = await realpath(await mkdtemp(join(tmpdir(), "ancientvoid-factory-")));
    project = join(dir, "projects", "proj");
    await mkdir(join(project, ".factory"), { recursive: true });
    await writeFile(join(project, ".factory", "config.json"), "{}\n");
    execFileSync("git", ["init", "-q", project]);
    execFileSync("git", ["-C", project, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "init"]);
    const db = new HubDatabase(":memory:");
    const store = new EventStore(join(dir, "events"));
    const securesight = createLoopConnector({ pollMs: 40, factory: STAND_IN });
    const registry = new AdapterRegistry();
    registry.register("claude", createDummy, { eventsPerSecond: 100, autoStopAfterEvents: 5 });
    registry.register("loop:securesight-factory", () => loopAsAdapter(securesight, { stateDir: join(dir, "loops") }), undefined, "loop:securesight-factory");
    const loops = new LoopRegistry();
    loops.register(securesight);
    registry.register("maki", (config) => {
      const dummy = createDummy(config);
      return { ...dummy, start: (spec, context) => {
        makiPrompt = spec.prompt;
        return dummy.start(spec, context);
      }, capabilities: () => {
        const caps = dummy.capabilities();
        return { ...caps, features: { ...caps.features, modelChoice: "start" } };
      } };
    }, { eventsPerSecond: 100, autoStopAfterEvents: 5 });
    sessions = new SessionManager(db, store, registry, new ProcessRunner(), undefined, new WorktreeManager(join(dir, "worktrees")));
    tokens = new TokenService(db);
    token = tokens.issue("test-device").token;
    app = await createHubApp({
      sessions,
      hostId: "factory-host",
      tokens,
      registry,
      auth: { tokens, enforceTailnetIdentity: false },
      store,
      loops,
      projectRoots: [join(dir, "projects")],
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
  });

  afterAll(async () => {
    await sessions.shutdown();
    await app.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  });

  const authed = (body: Record<string, unknown>, as: string) => ({
    method: "POST" as const,
    url: "/api/factory/start",
    headers: { authorization: `Bearer ${as}` },
    payload: body,
  });

  it("legt Treiber mit /factory-Auftrag und verknüpften Beobachter an (AC-P26-2 Kern)", async () => {
    const res = await app.inject(authed({ project, goal: "README zusammenfassen" }, token));
    expect(res.statusCode, res.body).toBe(201);
    const { driver, observer } = res.json() as { driver: { id: string; adapter: string; project: string }; observer: { id: string; adapter: string; project: string } };
    expect(driver.adapter).toBe("claude");
    expect(res.json().driver.hostId).toBe("factory-host");
    expect(res.json().observer.hostId).toBe("factory-host");
    expect(driver.project).toBe(project);
    expect((driver as { worktreeSha?: string | null }).worktreeSha).toBeNull();
    expect(observer.adapter).toBe("loop:securesight-factory");
    expect(observer.project).toBe(project);

    // Der Treiber trägt den Auftrag als /factory-Prompt (normaler Prompt-Weg).
    const driverEvents = await app.inject({ method: "GET", url: `/api/sessions/${driver.id}/events`, headers: { authorization: `Bearer ${token}` } });
    expect(driverEvents.json().some((e: { type: string; payload: { text?: string } }) => e.type === "user" && (e.payload?.text ?? "").startsWith("/factory README zusammenfassen"))).toBe(true);

    // Die Verknüpfung steht auf beiden Sessions als Ereignis (K7-Anzeige).
    for (const [id, role] of [[driver.id, "driver"], [observer.id, "observer"]] as const) {
      const events = await app.inject({ method: "GET", url: `/api/sessions/${id}/events`, headers: { authorization: `Bearer ${token}` } });
      const link = events.json().find((e: { payload: { kind?: string } }) => e.payload?.kind === "factory.linkage");
      expect(link?.payload.factory).toMatchObject({ role, partner: role === "driver" ? observer.id : driver.id });
    }
  });

  it("übernimmt maki/Z.ai, lädt den Factory-Skill und benennt beide Rollen", async () => {
    const root = join(dir, "projects", "maki");
    await mkdir(join(root, ".factory"), { recursive: true });
    await writeFile(join(root, ".factory/config.json"), "{}");
    await mkdir(join(root, ".claude/skills/factory"), { recursive: true });
    await writeFile(join(root, ".claude/skills/factory/SKILL.md"), "# Factory\nNutze factory progress show.");
    const res = await app.inject(authed({ project: root, goal: "Produkt bauen", adapter: "maki", model: "zai/glm-5.3" }, token));
    expect(res.statusCode, res.body).toBe(201);
    const { driver, observer } = res.json();
    expect(driver).toMatchObject({ adapter: "maki", model: "zai/glm-5.3", title: "Factory · Produkt bauen" });
    expect(observer.title).toBe("Factory-Beobachter · Produkt bauen");
    const events = (await app.inject({ method: "GET", url: `/api/sessions/${driver.id}/events`, headers: { authorization: `Bearer ${token}` } })).json();
    expect(makiPrompt).toContain("Nutze factory progress show.");
    expect(events.some((e: { type: string; payload: { text?: string } }) => e.type === "user" && e.payload.text === "/factory Produkt bauen")).toBe(true);
    const again = await app.inject(authed({ project: root, adapter: "maki" }, token));
    expect(again.statusCode).toBe(409);
  });

  it("lehnt maki ohne Factory-Skill vor dem Anlegen der Sessions laut ab", async () => {
    const root = join(dir, "projects", "missing-skill");
    await mkdir(join(root, ".factory"), { recursive: true });
    await writeFile(join(root, ".factory/config.json"), "{}");
    const list = () => app.inject({ method: "GET", url: "/api/sessions", headers: { authorization: `Bearer ${token}` } });
    const before = (await list()).json().length;
    const res = await app.inject(authed({ project: root, adapter: "maki" }, token));
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toContain("Factory-Skill fehlt");
    expect((await list()).json()).toHaveLength(before);
  });

  it("verhindert parallele Starts desselben Projekts", async () => {
    const root = join(dir, "projects", "parallel");
    await mkdir(join(root, ".factory"), { recursive: true });
    await writeFile(join(root, ".factory/config.json"), "{}");
    const results = await Promise.all([app.inject(authed({ project: root }, token)), app.inject(authed({ project: root }, token))]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
  });

  it("ein Agent-Token darf keinen Factory-Lauf starten (Policy factory.start, AC-P26-5)", async () => {
    const agentToken = tokens.issue("agent:test").token;
    const res = await app.inject(authed({ project }, agentToken));
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain("factory.start");
  });

  it("Projekt außerhalb der Projekt-Wurzeln wird laut abgelehnt", async () => {
    const res = await app.inject(authed({ project: "/tmp/woanders" }, token));
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toContain("projectRoots");
  });

  it("ohne lauffähigen Beobachter wird der Treiber zurückgerollt (kein halbgareller Lauf)", async () => {
    // Zweite App: Loop-Katalog kennt securesight (assertStartable grün), aber
    // der interne Loop-Adapter ist nicht registriert — create scheitert.
    const db2 = new HubDatabase(":memory:");
    const store2 = new EventStore(join(dir, "events2"));
    const securesight = createLoopConnector({ pollMs: 40 });
    const registry2 = new AdapterRegistry();
    registry2.register("claude", createDummy, { eventsPerSecond: 100, autoStopAfterEvents: 5 });
    const loops2 = new LoopRegistry();
    loops2.register(securesight);
    const sessions2 = new SessionManager(db2, store2, registry2, new ProcessRunner());
    const tokens2 = new TokenService(db2);
    const token2 = tokens2.issue("test-device-2").token;
    const app2 = await createHubApp({
      sessions: sessions2,
      tokens: tokens2,
      registry: registry2,
      auth: { tokens: tokens2, enforceTailnetIdentity: false },
      store: store2,
      loops: loops2,
      projectRoots: [join(dir, "projects")],
    });
    try {
      const res = await app2.inject(authed({ project }, token2));
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toContain("Beobachter");
      // Rollback: genau der Treiber existiert, und er ist nicht laufen gelassen.
      const list = await app2.inject({ method: "GET", url: "/api/sessions", headers: { authorization: `Bearer ${token2}` } });
      const records = list.json() as { id: string; adapter: string; status: string }[];
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ adapter: "claude" });
      expect(["stopped", "stopping", "idle"]).toContain(records[0]!.status);
    } finally {
      await sessions2.shutdown();
      await app2.close().catch(() => undefined);
    }
  });
  describe("Steuerung (T26.6, AC-P26-5)", () => {
    const post = (id: string, body: Record<string, unknown>, as = token) => app.inject({ method: "POST", url: `/api/factory/${id}/command`, headers: { authorization: `Bearer ${as}` }, payload: body });
    const events = async (id: string) => (await app.inject({ method: "GET", url: `/api/sessions/${id}/events`, headers: { authorization: `Bearer ${token}` } })).json() as { type: string; payload: { kind?: string; text?: string; factory?: { command?: string; outcome?: string; actor?: string } } }[];
    const audits = async (id: string) => (await events(id)).filter((e) => e.payload?.kind === "factory.command").map((e) => e.payload.factory!);

    async function startRun(name: string): Promise<{ driver: string; observer: string; root: string }> {
      const root = join(dir, "projects", name);
      await mkdir(join(root, ".factory"), { recursive: true });
      await writeFile(join(root, ".factory/config.json"), JSON.stringify({ schema_version: "1", modus: "b" }));
      const res = await app.inject(authed({ project: root, goal: "Lauf" }, token));
      expect(res.statusCode, res.body).toBe(201);
      return { driver: res.json().driver.id, observer: res.json().observer.id, root };
    }

    it("ein Agent-Token kann keinen Befehl auslösen (Policy factory.control), es entsteht kein Audit-Ereignis", async () => {
      const run = await startRun("ctl-agent");
      const agent = tokens.issue("agent:ctl").token;
      const res = await post(run.observer, { command: "end_run" }, agent);
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain("factory.control");
      expect(await audits(run.observer)).toHaveLength(0);
      expect(sessions.get(run.driver)?.status).not.toBe("stopped");
    });

    it("alles außerhalb der Allowlist wird mit Grund abgelehnt und auditiert", async () => {
      const run = await startRun("ctl-allow");
      const res = await post(run.observer, { command: "rm_rf" });
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toContain("Allowlist");
      const ack = await post(run.driver, { command: "notify_ack" });
      expect(ack.statusCode).toBe(422);
      expect(ack.json().error).toContain("Modus repo");
      // Das Audit steht auf beiden Sessions des Laufs, mit Akteur und Ergebnis.
      for (const id of [run.driver, run.observer]) {
        expect((await audits(id)).map((a) => a.outcome)).toEqual(["abgelehnt", "abgelehnt"]);
      }
    });

    it("Betriebsart a ohne Bestätigung → 409 und Projekt bleibt unverändert; mit Bestätigung rekonfiguriert die Factory", async () => {
      const run = await startRun("ctl-mode");
      const before = readFileSync(join(run.root, ".factory/config.json"), "utf8");
      const denied = await post(run.observer, { command: "set_mode", modus: "a", provider: "anthropic" });
      expect(denied.statusCode).toBe(409);
      expect(denied.json().needsConfirm).toBe(true);
      expect(readFileSync(join(run.root, ".factory/config.json"), "utf8")).toBe(before);
      const ok = await post(run.observer, { command: "set_mode", modus: "a", provider: "anthropic", confirm: true });
      expect(ok.statusCode, ok.body).toBe(200);
      expect(JSON.parse(readFileSync(join(run.root, ".factory/config.json"), "utf8"))).toMatchObject({ modus: "a", auto_merge: true });
      expect((await audits(run.driver)).map((a) => a.outcome)).toEqual(["bestätigung fehlt", "ok"]);
      // Betriebsart b braucht keine Bestätigung.
      expect((await post(run.observer, { command: "set_mode", modus: "b", provider: "zai" })).statusCode).toBe(200);
    });

    it("Fortsetzen schickt /factory an den Treiber, Beenden stoppt beide Sessions", async () => {
      const run = await startRun("ctl-end");
      const resume = await post(run.observer, { command: "resume" });
      expect(resume.statusCode, resume.body).toBe(200);
      expect((await events(run.driver)).filter((e) => e.type === "user" && e.payload.text === "/factory").length).toBeGreaterThanOrEqual(1);
      const end = await post(run.driver, { command: "end_run" });
      expect(end.statusCode, end.body).toBe(200);
      expect(sessions.get(run.driver)?.status).toBe("stopped");
      expect(sessions.get(run.observer)?.status).toBe("stopped");
      expect((await audits(run.observer)).at(-1)).toMatchObject({ command: "end_run", outcome: "ok" });
    });

    it("eine Session ohne Factory-Verknüpfung wird abgelehnt", async () => {
      const plain = await app.inject({ method: "POST", url: "/api/sessions", headers: { authorization: `Bearer ${token}` }, payload: { adapter: "claude", project } });
      const res = await post(plain.json().id, { command: "end_run" });
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toContain("Factory-Lauf");
    });
  });
  describe("Secrets und Schreibgrenze (AC-P26-7)", () => {
    const tree = (root: string): Record<string, string> => {
      const out: Record<string, string> = {};
      const walk = (d: string) => {
        for (const name of readdirSync(d)) {
          if (name === ".git") continue;
          const p = join(d, name);
          if (statSync(p).isDirectory()) walk(p);
          else out[p.slice(root.length)] = readFileSync(p, "utf8");
        }
      };
      walk(root);
      return out;
    };

    it("kein Schlüssel aus dem Projekt gelangt in Events oder API-Antworten, und der Hub schreibt nichts ins Projekt", async () => {
      const SECRET = "sk-LEAK-0123456789";
      const root = join(dir, "projects", "leak");
      await mkdir(join(root, ".factory", "intake"), { recursive: true });
      await writeFile(join(root, ".factory/config.json"), JSON.stringify({ schema_version: "1", modus: "b", api_key: SECRET }));
      await writeFile(join(root, ".factory/intake/state.json"), JSON.stringify({ schema_version: "1", status: "ready", execution_ready: true, next_action: "los", token: SECRET }));
      await writeFile(join(root, ".factory/lauf-status.json"), JSON.stringify({ schema_version: "1", task: "T-1", phase: "bauen", heartbeat_at: Math.floor(Date.now() / 1000), secret: SECRET }));
      await mkdir(join(root, ".factory/evidence"), { recursive: true });
      await writeFile(join(root, ".factory/evidence/bootstrap-fehler.json"), JSON.stringify({ schema_version: "1", zeit: "2026-11-09T10:00:00Z", grund: "trust fehlt", fundstelle: "init", key: SECRET }));
      const before = tree(root);

      const res = await app.inject(authed({ project: root, goal: "Lauf" }, token));
      expect(res.statusCode, res.body).toBe(201);
      const { driver, observer } = res.json() as { driver: { id: string }; observer: { id: string } };
      await new Promise((r) => setTimeout(r, 600)); // mehrere Poll-Takte des Beobachters (pollMs 40)

      const bodies = [res.body];
      for (const id of [driver.id, observer.id]) {
        bodies.push((await app.inject({ method: "GET", url: `/api/sessions/${id}/events`, headers: { authorization: `Bearer ${token}` } })).body);
        bodies.push((await app.inject({ method: "GET", url: `/api/sessions/${id}`, headers: { authorization: `Bearer ${token}` } })).body);
      }
      bodies.push((await app.inject({ method: "GET", url: "/api/loops", headers: { authorization: `Bearer ${token}` } })).body);
      for (const b of bodies) expect(b).not.toContain(SECRET);
      // Der Beobachter hat gelesen (Fehlerbeleg angekommen) …
      expect(bodies.join("\n")).toContain("trust fehlt");
      // … und nichts geschrieben: der Projektbaum ist byte-gleich.
      expect(tree(root)).toEqual(before);
    });
  });
});
