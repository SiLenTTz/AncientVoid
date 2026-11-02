import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { EventStore, HubDatabase, LoopRegistry, SessionManager, AdapterRegistry, TokenService, loopAsAdapter, WorktreeManager } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import { createAdapter as createDummy } from "@ancientvoid/adapter-dummy";
import { createLoopConnector } from "@ancientvoid/loop-securesight-factory";
import { createHubApp } from "../src/app.ts";

/**
 * EPIC-P26 T26.5 / ADR-0043: `POST /api/factory/start` legt Treiber (Claude,
 * erster Prompt `/factory`) und Beobachter (Loop project-Modus) verknüpft an.
 * Die Treiber sind Dummys unter den produktiven Namen claude/maki;
 * Auswahl, Skill-Auflösung, Workdir und HTTP-Vertrag bleiben echt.
 */
describe("Factory-Start (T26.5, ADR-0043)", () => {
  let dir: string;
  let app: FastifyInstance;
  let token: string;
  let tokens: TokenService;
  let project: string;
  let sessions: SessionManager;
  let makiPrompt: string | undefined;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-factory-"));
    project = join(dir, "projects", "proj");
    await mkdir(join(project, ".factory"), { recursive: true });
    await writeFile(join(project, ".factory", "config.json"), "{}\n");
    execFileSync("git", ["init", "-q", project]);
    execFileSync("git", ["-C", project, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "init"]);
    const db = new HubDatabase(":memory:");
    const store = new EventStore(join(dir, "events"));
    const securesight = createLoopConnector({ pollMs: 40 });
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
    const { driver } = res.json();
    expect(driver).toMatchObject({ adapter: "maki", model: "zai/glm-5.3" });
    const events = (await app.inject({ method: "GET", url: `/api/sessions/${driver.id}/events`, headers: { authorization: `Bearer ${token}` } })).json();
    expect(makiPrompt).toContain("Nutze factory progress show.");
    expect(events.some((e: { type: string; payload: { text?: string } }) => e.type === "user" && e.payload.text === "/factory Produkt bauen")).toBe(true);
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
});
