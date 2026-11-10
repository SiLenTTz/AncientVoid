import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { EventStore, SessionManager, AdapterRegistry, HubDatabase, TokenService, AutomationService, type AutomationLauncher, type AutomationPrechecker } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import { createHubApp } from "../../../src/app.ts";
import { operationOf } from "../../../src/platform/policy.ts";
import { mapLaunchFailure } from "../../../src/modules/automations/automations-service.ts";

/**
 * EPIC-P41 T41.4: Routen + Policy — Agenten dürfen die Liste sehen (read),
 * aber Verwaltung und Run-now gehören Mensch und Flotte (ADR-0064). Neue
 * Definition beginnt deaktiviert; Run-now dispatcht über den Launcher.
 */

const PROMPT = "Tageszusammenfassung fahren.";
const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

describe("automations routes and policy (EPIC-P41 T41.4)", () => {
  it("the policy table owns the endpoints — manage/run-now are not read", () => {
    expect(operationOf("POST", "/api/automations", {})).toBe("automations.manage");
    expect(operationOf("POST", "/api/automations/abc/run-now", {})).toBe("automations.runNow");
    expect(operationOf("PATCH", "/api/automations/abc", {})).toBe("automations.manage");
    expect(operationOf("POST", "/api/automations/abc/enable", {})).toBe("automations.manage");
  });

  it("launch failures keep their separate reasons instead of collapsing into one", () => {
    expect(mapLaunchFailure("In diesem Arbeitsverzeichnis läuft bereits eine andere AncientVoid-Session.")).toBe("lease");
    expect(mapLaunchFailure("Budget überschritten")).toBe("quota");
    expect(mapLaunchFailure("policy: not allowed")).toBe("auth");
    expect(mapLaunchFailure("adapter offline")).toBe("host_down");
  });

  let dir: string;
  let app: FastifyInstance;
  let agentToken: string;
  let humanToken: string;
  const launched: { claimKey: string; kind: string; promptText: string | null }[] = [];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-automations-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const sessions = new SessionManager(db, store, new AdapterRegistry(), new ProcessRunner());
    const tokens = new TokenService(db);
    agentToken = tokens.issue("agent:audit").token;
    humanToken = tokens.issue("test-device").token;
    const launcher: AutomationLauncher = {
      async launch(_definition, promptText, claimKey, kind) {
        launched.push({ claimKey, kind, promptText });
        return { ok: true, sessionId: `sess-${launched.length}` };
      },
    };
    const prechecker: AutomationPrechecker = { async run() { return null; } };
    const automations = new AutomationService({ root: join(dir, "automations"), hostId: "host-test", launcher, prechecker });
    app = await createHubApp({ sessions, tokens, registry: new AdapterRegistry(), auth: { tokens, enforceTailnetIdentity: false }, store, dataDir: dir, automations });
    await app.listen({ port: 0, host: "127.0.0.1" });
  });

  afterAll(async () => {
    await app.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  });

  const definition = {
    id: "aut-test",
    label: "Test-Automation",
    generation: 1,
    enabled: false,
    hostId: "host-test",
    schedule: { kind: "cron", cron: "0 8 * * *", timezone: "UTC" },
    target: { kind: "session", harness: "pi", workdir: "worktree", project: "/tmp", promptBlobSha256: sha(PROMPT) },
    grant: { maxParallel: 1, missedGraceMs: 0 },
    createdAtUtc: "2026-01-05T10:00:00.000Z",
  };

  it("an agent may list but not create, run-now, or enable", async () => {
    const agent = { authorization: `Bearer ${agentToken}` };
    expect((await app.inject({ method: "GET", url: "/api/automations", headers: agent })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/automations", headers: agent, payload: { definition, promptText: PROMPT } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/automations/any-id/run-now", headers: agent })).statusCode).toBe(403);
  });

  it("a human creates (starts disabled), enables, and runs now through the launcher with the blob text", async () => {
    const human = { authorization: `Bearer ${humanToken}` };
    const created = await app.inject({ method: "POST", url: "/api/automations", headers: human, payload: { definition, promptText: PROMPT } });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.enabled).toBe(false);
    const id = body.id as string;

    expect((await app.inject({ method: "POST", url: `/api/automations/${id}/enable`, headers: human, payload: { enabled: true } })).statusCode).toBe(200);
    const runNow = await app.inject({ method: "POST", url: `/api/automations/${id}/run-now`, headers: human });
    expect(runNow.statusCode).toBe(202);
    expect(runNow.json().state).toBe("dispatched");
    expect(launched.at(-1)!.kind).toBe("run_now");
    expect(launched.at(-1)!.promptText).toBe(PROMPT);

    const history = await app.inject({ method: "GET", url: `/api/automations/${id}/history`, headers: human });
    expect(history.statusCode).toBe(200);
    expect(history.json().history[0].state).toBe("dispatched");
  });

  it("a run target fails loud at creation in this build (P40 launcher not wired)", async () => {
    const human = { authorization: `Bearer ${humanToken}` };
    const res = await app.inject({ method: "POST", url: "/api/automations", headers: human, payload: { definition: { ...definition, target: { kind: "run", templateId: "tpl-1" } } } });
    expect(res.statusCode).toBe(501);
  });

  it("unknown ids and mismatched blobs fail loud, never silently", async () => {
    const human = { authorization: `Bearer ${humanToken}` };
    expect((await app.inject({ method: "POST", url: "/api/automations/nope/run-now", headers: human })).statusCode).toBe(404);
    const res = await app.inject({ method: "POST", url: "/api/automations", headers: human, payload: { definition, promptText: "anderer Text" } });
    expect(res.statusCode).toBe(400);
  });
});
