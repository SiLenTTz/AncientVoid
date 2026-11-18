import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basicFeatures } from "@ancientvoid/contracts";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
import { EventStore, SessionManager, AdapterRegistry, HubDatabase, TokenService } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import { createHubApp } from "../../../src/app.ts";

const exec = promisify(execFile);

/** EPIC-P70 (ADR-0092): Release-Notes-Routen — Liste klein (K5-Geist), Detail on
 * demand, Auth/Guards wie git-graph (ADR-0071), ehrliche Fehler (AC-P70-5/6). */

let base: string;
let repo: string;
let app: FastifyInstance;
let token: string;

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec("git", ["-C", cwd, ...args]);
  return stdout;
}

async function commitFile(cwd: string, path: string, content: string, subject: string, body?: string): Promise<void> {
  await writeFile(join(cwd, path), content);
  await git(cwd, "add", ".");
  await git(cwd, "commit", "-q", "-m", subject, ...(body ? ["-m", body] : []));
}

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "av-rn-hub-"));
  repo = join(base, "proj");
  await mkdir(repo, { recursive: true });
  await git(repo, "init", "-q", "-b", "main");
  await git(repo, "config", "user.email", "t@t.com");
  await git(repo, "config", "user.name", "T");
  await commitFile(repo, "README.md", "# hi\n", "init");

  await git(repo, "checkout", "-q", "-b", "feat/eins");
  await commitFile(repo, "a.ts", "a;\n", "^ F core: erste Faehigkeit", "Warum: der Handy-Abfluss braucht sie.");
  await git(repo, "checkout", "-q", "main");
  await git(repo, "merge", "--no-ff", "-q", "-m", "^ F core: erste Faehigkeit (#1)", "-m", "PR-Beschreibung: bündelt T1.", "feat/eins");

  // Zweiter PR ohne Notation im Subject — muss roh bleiben (fail loud, AC-P70-3).
  await git(repo, "checkout", "-q", "-b", "feat/zwei");
  await commitFile(repo, "c.ts", "c;\n", "! B pwa: fehler repariert", "BUG-0001: Anzeige blieb stehen.");
  await git(repo, "checkout", "-q", "main");
  await git(repo, "merge", "--no-ff", "-q", "-m", "BUG-0001: Chat laedt wieder (#2)", "-m", "Warum: Regression.", "feat/zwei");

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
  token = tokens.issue("test-device").token;
  app = await createHubApp({
    sessions,
    tokens,
    registry,
    auth: { tokens, enforceTailnetIdentity: false },
    store,
    projectRoots: [base],
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
});

afterAll(async () => {
  await app.close();
  await rm(base, { recursive: true, force: true });
});

const headers = (): { authorization: string } => ({ authorization: `Bearer ${token}` });
const listUrl = (): string => `/api/release-notes?project=${encodeURIComponent(repo)}`;

describe("release-notes routes (integration, ADR-0092)", () => {
  it("GET /api/release-notes listet PRs neueste zuerst; rohe Subjects bleiben (AC-P70-1/3)", async () => {
    const res = await app.inject({ method: "GET", url: listUrl(), headers: headers() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      entries: { notation: { prNumber: number | null; unparsed: boolean; summary: string }; stats: { filesChanged: number } | null }[];
      truncated: boolean;
    };
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0]!.notation.prNumber).toBe(2);
    expect(body.entries[0]!.notation.unparsed).toBe(true);
    expect(body.entries[1]!.notation.summary).toBe("erste Faehigkeit");
    expect(body.entries[1]!.stats?.filesChanged).toBeGreaterThanOrEqual(1);
  });

  it("Liste trägt keine Bodies (K5-Geist, AC-P70-4)", async () => {
    const res = await app.inject({ method: "GET", url: listUrl(), headers: headers() });
    const body = res.json() as Record<string, unknown>[];
    expect(JSON.stringify(body)).not.toContain("PR-Beschreibung");
    expect(body[0]?.body).toBeUndefined();
  });

  it("GET detail liefert Warum (PR-Body) und Was (Commits, Dateien) — AC-P70-2", async () => {
    const list = (await app.inject({ method: "GET", url: listUrl(), headers: headers() })).json() as { entries: { mergeSha: string }[] };
    const sha = list.entries[1]!.mergeSha;
    const res = await app.inject({
      method: "GET",
      url: `/api/release-notes/detail?project=${encodeURIComponent(repo)}&merge=${sha}`,
      headers: headers(),
    });
    expect(res.statusCode).toBe(200);
    const detail = res.json() as { body: string; commits: { notation: { summary: string }; body: string }[]; files: { path: string }[] };
    expect(detail.body).toContain("bündelt T1");
    expect(detail.commits.map((c) => c.notation.summary)).toEqual(["erste Faehigkeit"]);
    expect(detail.commits[0]!.body).toContain("Warum");
    expect(detail.files.map((f) => f.path)).toContain("a.ts");
  });

  it("detail: unbekannter SHA → 404, ohne merge → 400 (AC-P70-6)", async () => {
    const notFound = await app.inject({
      method: "GET",
      url: `/api/release-notes/detail?project=${encodeURIComponent(repo)}&merge=${"0".repeat(40)}`,
      headers: headers(),
    });
    expect(notFound.statusCode).toBe(404);
    const noMerge = await app.inject({ method: "GET", url: `/api/release-notes/detail?project=${encodeURIComponent(repo)}`, headers: headers() });
    expect(noMerge.statusCode).toBe(400);
  });

  it("Guard-Flächen: ohne Param 400, außerhalb projectRoots 422, ohne Token 401 (AC-P70-6)", async () => {
    expect((await app.inject({ method: "GET", url: "/api/release-notes", headers: headers() })).statusCode).toBe(400);
    const outside = await app.inject({ method: "GET", url: `/api/release-notes?project=${encodeURIComponent(tmpdir())}`, headers: headers() });
    expect(outside.statusCode).toBe(422);
    expect((await app.inject({ method: "GET", url: listUrl() })).statusCode).toBe(401);
  });

  it("Nicht-Git-Projekt antwortet 200 mit benanntem Fehler statt stiller Leerliste (AC-P70-5)", async () => {
    const plain = join(base, "plain");
    await mkdir(plain);
    const res = await app.inject({ method: "GET", url: `/api/release-notes?project=${encodeURIComponent(plain)}`, headers: headers() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { entries: unknown[]; error?: string };
    expect(body.entries).toEqual([]);
    expect(body.error).toBe("Kein Git-Repository.");
  });

  it("session= zeigt den Ausschnitt des Session-Worktrees (ADR-0092 §5)", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: headers(),
      payload: { project: repo, adapter: "dummy", prompt: "start" },
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json() as { id: string };
    const id = createdBody.id;
    const res = await app.inject({ method: "GET", url: `/api/release-notes?session=${encodeURIComponent(id)}`, headers: headers() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { entries: { notation: { prNumber: number } }[] };
    expect(body.entries.length).toBeGreaterThanOrEqual(2);
  });
});
