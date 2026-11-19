import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { EventStore, SessionManager, AdapterRegistry, HubDatabase, TokenService } from "@ancientvoid/core";
import type { ExternalJobInfo } from "@ancientvoid/contracts";
import { ProcessRunner } from "@ancientvoid/workers";
import { createHubApp } from "../../../src/app.ts";
import { ExternalJobsService, workflowStatus } from "../../../src/modules/automations/external-jobs.ts";

/**
 * EPIC-P73 (ADR-0094): GET /api/automations/external — die Anzeige der
 * Auto-Jobs außerhalb des Schedulers. Ohne Quellen ehrlich leer; bei Fehler
 * des Frischversuchs letzte gute Liste MIT Zeitstempel und Fehlerklasse (K10).
 */

describe("external jobs endpoint (EPIC-P73, ADR-0094)", () => {
  it("maps workflow status/conclusion onto the display scale, unknown stays unknown", () => {
    expect(workflowStatus({ status: "in_progress", conclusion: null })).toBe("running");
    expect(workflowStatus({ status: "queued", conclusion: null })).toBe("queued");
    expect(workflowStatus({ status: "completed", conclusion: "success" })).toBe("succeeded");
    expect(workflowStatus({ status: "completed", conclusion: "failure" })).toBe("failed");
    expect(workflowStatus({ status: "completed", conclusion: "cancelled" })).toBe("cancelled");
    expect(workflowStatus({ status: "completed", conclusion: "startup_failure" })).toBe("unknown");
    expect(workflowStatus({ status: "weird", conclusion: null })).toBe("unknown");
  });

  let dir: string;
  let app: FastifyInstance;
  let headers: { authorization: string };
  const runs = [
    { workflow: "nightly", runName: "Full suite", status: "completed", conclusion: "failure", event: "schedule", url: "https://github.com/o/r/actions/runs/1", atUtc: "2026-11-19T03:12:44.000Z" },
    { workflow: "verify", runName: "PR check", status: "in_progress", conclusion: null, event: "pull_request", url: "https://github.com/o/r/actions/runs/2", atUtc: "2026-11-19T09:00:00.000Z" },
  ];
  const bridgeJobs: ExternalJobInfo[] = [
    { source: "issue-bridge", name: "Issue #12: Spinne läuft", status: "running", detail: "Session abc12345", url: "https://github.com/o/r/issues/12", atUtc: "2026-11-19T08:30:00.000Z" },
  ];
  let failActions = false;
  let virtualTime = Date.parse("2026-11-19T10:00:00.000Z");

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-external-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const sessions = new SessionManager(db, store, new AdapterRegistry(), new ProcessRunner());
    const tokens = new TokenService(db);
    headers = { authorization: `Bearer ${tokens.issue("test-device").token}` };
    const externalJobs = new ExternalJobsService({
      actions: {
        listLatestWorkflowRuns: async () => {
          if (failActions) throw new Error("HTTP 403 rate limited");
          return runs;
        },
      },
      bridge: { jobs: () => bridgeJobs },
      ttlMs: 60_000,
      now: () => new Date((virtualTime += 120_000)), // je Anfrage über der TTL
    });
    app = await createHubApp({ sessions, tokens, registry: new AdapterRegistry(), auth: { tokens, enforceTailnetIdentity: false }, store, dataDir: dir, externalJobs });
    await app.listen({ port: 0, host: "127.0.0.1" });
  });

  afterAll(async () => {
    await app.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  });

  it("liefert Bridge- und Actions-Jobs gemischt mit Status und Links", async () => {
    const res = await app.inject({ method: "GET", url: "/api/automations/external", headers });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { atUtc: string; staleError: string | null; jobs: ExternalJobInfo[] };
    expect(body.staleError).toBeNull();
    expect(body.jobs).toHaveLength(3);
    expect(body.jobs[0]).toMatchObject({ source: "issue-bridge", status: "running" });
    const nightly = body.jobs.find((j) => j.name === "nightly");
    expect(nightly).toMatchObject({ source: "github-actions", status: "failed", url: runs[0]!.url, atUtc: runs[0]!.atUtc });
    expect(body.jobs.find((j) => j.name === "verify")).toMatchObject({ status: "running" });
  });

  it("hält bei Frisch-Fehler die letzte gute Liste mit Zeitstempel und Fehlerklasse (K10)", async () => {
    failActions = true;
    const res = await app.inject({ method: "GET", url: "/api/automations/external", headers: { authorization: `${headers.authorization}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { atUtc: string; staleError: string | null; jobs: ExternalJobInfo[] };
    expect(body.staleError).toContain("HTTP 403");
    expect(body.jobs).toHaveLength(3); // letzte gute Liste bleibt
    failActions = false;
  });
});

describe("external jobs endpoint ohne Quellen (EPIC-P73)", () => {
  it("antwortet ehrlich leer statt 501 — kein Scheduler nötig", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-external-off-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const sessions = new SessionManager(db, store, new AdapterRegistry(), new ProcessRunner());
    const tokens = new TokenService(db);
    const app = await createHubApp({ sessions, tokens, registry: new AdapterRegistry(), auth: { tokens, enforceTailnetIdentity: false }, store, dataDir: dir });
    try {
      await app.listen({ port: 0, host: "127.0.0.1" });
      const res = await app.inject({ method: "GET", url: "/api/automations/external", headers: { authorization: `Bearer ${tokens.issue("test-device").token}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ staleError: null, jobs: [] });
    } finally {
      await app.close().catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
