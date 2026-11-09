import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
import { basicFeatures, type Adapter, type AdapterContext, type SteerInput } from "@ancientvoid/contracts";
import { EventStore, SessionManager, AdapterRegistry, HubDatabase, TokenService, WorktreeManager } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import { createHubApp } from "../../../src/app.ts";
import { ForgeService } from "../../../src/modules/forge/forge-service.ts";

const execAsync = promisify(execFile);

/**
 * EPIC-P37 T37.2–T37.5: Forge-Routen über einen echten Hub mit glab-Stub
 * und einem lokalen Bare-Repo als Origin (insteadOf-Umleitung, damit die
 * Remote-URL wie GitLab aussieht, Push aber lokal bleibt — keine
 * Produktiv-Mutation).
 */

const steered: SteerInput[] = [];

function recordingAdapter(): Adapter {
  return {
    id: "rec",
    version: "0.0.1",
    capabilities: () => ({
      reasoning: false,
      tools: false,
      cost: false,
      steer: true,
      usage: false,
      nativeDiscovery: "none",
      nativeResume: "none",
      features: basicFeatures({ followUp: true, interrupt: true }),
    }),
    async start(_spec, ctx: AdapterContext) {
      return { sessionId: ctx.sessionId };
    },
    async steer(_handle, input) {
      steered.push(input);
      return { ok: true };
    },
    async recover(sessionId) {
      return { sessionId };
    },
    async status() {
      return { state: "healthy" };
    },
    async stop() {},
  };
}

async function git(repo: string, ...args: string[]): Promise<void> {
  await execAsync("git", ["-C", repo, ...args]);
}

describe("forge routes (integration, glab-Stub)", () => {
  let base: string;
  let app: FastifyInstance;
  let token: string;
  let sessionId: string;
  const auth = { authorization: "" };
  const stub = resolve(import.meta.dirname, "../../fixtures/glab-stub.mjs");

  async function buildApp(): Promise<FastifyInstance> {
    const db = new HubDatabase(join(base, "hub.db"));
    const store = new EventStore(join(base, "hub", "sessions"));
    const registry = new AdapterRegistry();
    registry.register("rec", () => recordingAdapter());
    const sessions = new SessionManager(db, store, registry, new ProcessRunner(), undefined, new WorktreeManager(join(base, "hub", "worktrees")));
    await sessions.recoverAll();
    const tokens = new TokenService(db);
    const issued = tokens.issue("test-device").token;
    const forge = new ForgeService({ dataRoot: join(base, "hub"), command: stub, cacheTtlMs: 0 });
    const built = await createHubApp({
      sessions,
      tokens,
      registry,
      auth: { tokens, enforceTailnetIdentity: false },
      store,
      forge,
      projectRoots: [base],
    });
    await built.listen({ port: 0, host: "127.0.0.1" });
    token = issued;
    return built;
  }

  const setAuth = () => {
    auth.authorization = `Bearer ${token}`;
  };

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), "av-forge-int-"));
    // Bare-Repo als Origin + Arbeitsrepo; Remote-URL sieht via insteadOf
    // wie GitLab aus (Push bleibt lokal — nie Produktiv-Mutation).
    const bare = join(base, "remote.git");
    await execAsync("git", ["init", "--bare", "-b", "main", bare]);
    const repo = join(base, "proj");
    await execAsync("git", ["init", "-b", "main", repo]);
    await git(repo, "config", "user.email", "test@ancientvoid.local");
    await git(repo, "config", "user.name", "Test");
    await git(repo, "config", `url.${bare}.insteadOf`, "ssh://git@gitlab.example/team/proj.git");
    await git(repo, "remote", "add", "origin", "ssh://git@gitlab.example/team/proj.git");
    await writeFile(join(repo, "datei.txt"), "inhalt\n");
    await git(repo, "add", ".");
    await git(repo, "commit", "-m", "initial");
    await git(repo, "push", "-u", "origin", "main");

    process.env.GLAB_STUB_STATE = join(base, "glab-state.json");
    app = await buildApp();
    setAuth();
    const res = await app.inject({ method: "POST", url: "/api/sessions", headers: auth, payload: { adapter: "rec", project: repo } });
    expect(res.statusCode).toBe(201);
    sessionId = res.json().id;
  });

  afterAll(async () => {
    await app.close().catch(() => undefined);
    delete process.env.GLAB_STUB_STATE;
    delete process.env.GLAB_STUB_LOSE_RESPONSE;
    await rm(base, { recursive: true, force: true });
  });

  it("verknüpft per MR-URL, löst das Projekt auf und zeigt Überblick mit Pipelines", async () => {
    const link = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/forge/link`,
      headers: auth,
      payload: { url: "https://gitlab.example/team/proj/-/merge_requests/7" },
    });
    expect(link.statusCode).toBe(200);
    expect(link.json().link.mr).toMatchObject({ host: "gitlab.example", projectId: 42, mrIid: 7 });

    const overview = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}/forge/overview`, headers: auth });
    expect(overview.statusCode).toBe(200);
    const body = overview.json();
    expect(body.mr.sha).toBe("aaaa000000000000000000000000000000000000");
    // Session-Branch ist der Worktree-Branch — ständig erkennbar (AC-P37-1)
    expect(body.sessionBranch).toMatch(/^ancientvoid\//);
    expect(body.pipelines.map((p: { status: string }) => p.status)).toContain("pending");
    expect(body.shaDrift).toBe(false);
  });

  it("Jobs inklusive Bridge mit Downstream-Pipeline (AC-P37-2)", async () => {
    const jobs = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}/forge/jobs?pipelineId=3`, headers: auth });
    expect(jobs.statusCode).toBe(200);
    const items = jobs.json().items as Array<{ kind: string; downstreamPipelineId: number | null }>;
    expect(items.some((j) => j.kind === "job")).toBe(true);
    const bridge = items.find((j) => j.kind === "bridge");
    expect(bridge?.downstreamPipelineId).toBe(77);
  });

  it("Threads und Trace-Vorschau (K3: gekappt, mit Zeitstempel)", async () => {
    const threads = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}/forge/threads`, headers: auth });
    expect(threads.statusCode).toBe(200);
    expect(threads.json().items[0].notes[0].body).toContain("Zeile 12");

    const trace = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}/forge/trace?jobId=55&pipelineId=3`, headers: auth });
    expect(trace.statusCode).toBe(200);
    expect(trace.json().preview).toContain("Fehler in app.ts:12");
    expect(trace.json().fetchedAt).toBeTruthy();
    // Vollständige Trace-Datei liegt unter dataDir (ADR §10)
    const stored = await readFile(join(base, "hub", "forge", sessionId, "traces", "55.log"), "utf8");
    expect(stored).toContain("Zeile 3");
  });

  it("Feedback erreicht den Agenten mit Quelle und SHA; Doppelklick dupliziert nicht (AC-P37-3)", async () => {
    const before = steered.length;
    const preview = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/forge/feedback/preview`,
      headers: auth,
      payload: { finding: "verify rot: Fehler in app.ts:12", pipelineId: 3, jobId: 55 },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().prompt).toContain("Pipeline 3 · Job 55");
    expect(preview.json().prompt).toContain("geprüfter SHA aaaa0000");

    const send = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/forge/feedback`,
      headers: auth,
      payload: { operationId: "forge-op-0001", finding: "verify rot: Fehler in app.ts:12", pipelineId: 3, jobId: 55 },
    });
    expect(send.statusCode).toBe(200);
    expect(steered.length).toBe(before + 1);
    const last = steered.at(-1);
    expect(last?.kind).toBe("prompt");
    if (last?.kind === "prompt") expect(last.text).toContain("Pipeline 3 · Job 55");

    const dup = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/forge/feedback`,
      headers: auth,
      payload: { operationId: "forge-op-0001", finding: "verify rot: Fehler in app.ts:12", pipelineId: 3, jobId: 55 },
    });
    expect(dup.statusCode).toBe(200);
    expect(steered.length).toBe(before + 1);
  });

  it("SHA-Drift verweigert den Blindversand (§3.3)", async () => {
    await writeFile(join(base, "glab-state.json"), JSON.stringify({ mrSha: "bbbb000000000000000000000000000000000000", createdMrs: [] }));
    const send = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/forge/feedback`,
      headers: auth,
      payload: { operationId: "forge-op-0002", finding: "alter Befund", pipelineId: 3, jobId: 55 },
    });
    expect(send.statusCode).toBe(422);
    expect(send.json().detail).toContain("MR-SHA hat sich geändert");
    // Der Cache darf die Drift nicht weiter verdecken: die Übersicht zeigt sofort den neuen SHA.
    const after = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}/forge/overview`, headers: auth });
    expect(after.json().mr.sha).toBe("bbbb000000000000000000000000000000000000");
  });

  it("Draft-MR-Plan ist read-only und nennt Branch, Commits und Remote", async () => {
    const plan = await app.inject({ method: "POST", url: `/api/sessions/${sessionId}/forge/mr/plan`, headers: auth });
    expect(plan.statusCode).toBe(200);
    const body = plan.json();
    expect(body.branch).toMatch(/^ancientvoid\//);
    expect(body.host).toBe("gitlab.example");
    expect(body.projectPath).toBe("team/proj");
    expect(body.pushNeeded).toBe(true);
    expect(body.suggestedTitle).toBeTruthy();
  });

  it("Verlorene Antwort bei MR-Anlage: Retry findet den bestehenden MR, kein Duplikat (AC-P37-5)", async () => {
    process.env.GLAB_STUB_LOSE_RESPONSE = "1";
    const first = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/forge/mr/create`,
      headers: auth,
      payload: { operationId: "forge-mr-0001", title: "F pwa: Test", description: "Beschreibung", targetBranch: "main", push: true },
    });
    expect(first.statusCode).toBe(504);
    expect(first.json().state).toBe("uncertain");

    process.env.GLAB_STUB_LOSE_RESPONSE = "0";
    const ops = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}/forge/operations`, headers: auth });
    expect(ops.json().items.find((o: { id: string }) => o.id === "forge-mr-0001")?.state).toBe("uncertain");

    const retry = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/forge/mr/create`,
      headers: auth,
      payload: { operationId: "forge-mr-0001", title: "F pwa: Test", description: "Beschreibung", targetBranch: "main", push: true },
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().ok).toBe(true);
    expect(retry.json().webUrl).toContain("merge_requests/9");
    expect(retry.json().detail).toContain("kein zweiter erstellt");

    const state = JSON.parse(await readFile(join(base, "glab-state.json"), "utf8")) as { createdMrs: unknown[] };
    expect(state.createdMrs).toHaveLength(1);
    const final = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}/forge/operations`, headers: auth });
    expect(final.json().items.find((o: { id: string }) => o.id === "forge-mr-0001")?.state).toBe("done");
  });
});
