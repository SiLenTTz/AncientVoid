import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
import { basicFeatures, type Adapter, type AdapterContext, type SteerInput } from "@ancientvoid/contracts";
import { EventStore, SessionManager, AdapterRegistry, HubDatabase, TokenService, ReviewStore } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import { createHubApp } from "../../../src/app.ts";
import { resetDiffCacheForTests } from "../../../src/modules/reviews/reviews.routes.ts";

const execAsync = promisify(execFile);

async function git(repo: string, ...args: string[]): Promise<void> {
  await execAsync("git", ["-C", repo, ...args]);
}

async function headOf(repo: string): Promise<string> {
  const { stdout } = await execAsync("git", ["-C", repo, "rev-parse", "HEAD"]);
  return stdout.trim();
}

const steered: SteerInput[] = [];

function recordingAdapter(followUp = true): Adapter {
  return {
    id: followUp ? "rec" : "norf",
    version: "0.0.1",
    capabilities: () => ({
      reasoning: false,
      tools: false,
      cost: false,
      steer: true,
      usage: false,
      nativeDiscovery: "none",
      nativeResume: "none",
      features: basicFeatures({ followUp, interrupt: true }),
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

describe("reviews routes (integration)", () => {
  let repo: string;
  let hubDir: string;
  let app: FastifyInstance;
  let token: string;
  let sessionId: string;
  let headSha: string;

  async function buildApp(): Promise<FastifyInstance> {
    // SQLite hier dateibasiert: recoverAll() listet die Session-Records aus
    // der DB — mit :memory: wäre der Neustart-Test (K7) strukturell unmöglich.
    const db = new HubDatabase(join(hubDir, "hub.db"));
    const store = new EventStore(join(hubDir, "sessions"));
    const registry = new AdapterRegistry();
    registry.register("rec", () => recordingAdapter());
    registry.register("norf", () => recordingAdapter(false));
    const sessions = new SessionManager(db, store, registry, new ProcessRunner());
    // K7 wie main.ts: Recovery aus JSONL+Snapshot VOR HTTP — sonst ist die
    // Session nach dem Neustart unbekannt.
    const recovery = await sessions.recoverAll();
    if (recovery.recovered === 0 && process.env.AV_DEBUG_REVIEWS) console.log("recovery:", JSON.stringify(recovery));
    const tokens = new TokenService(db);
    const issued = tokens.issue("test-device").token;
    const built = await createHubApp({
      sessions,
      tokens,
      registry,
      auth: { tokens, enforceTailnetIdentity: false },
      store,
      reviews: new ReviewStore(join(hubDir, "reviews")),
      projectRoots: [join(repo, "..")],
    });
    await built.listen({ port: 0, host: "127.0.0.1" });
    token = issued;
    return built;
  }

  const auth = { authorization: "" };
  const setAuth = () => {
    auth.authorization = `Bearer ${token}`;
  };

  beforeAll(async () => {
    const base = await mkdtemp(join(tmpdir(), "av-reviews-int-"));
    repo = join(base, "proj");
    hubDir = join(base, "hub");
    await execFile("git", ["init", "-b", "main", repo]);
    await execAsync("git", ["-C", repo, "config", "user.email", "test@ancientvoid.local"]);
    await git(repo, "config", "user.name", "Test");
    await writeFile(join(repo, "src-app.ts"), ["line1", "line2", "line3", "line4", "line5"].join("\n") + "\n");
    await git(repo, "add", ".");
    await git(repo, "commit", "-m", "initial");
    headSha = await headOf(repo);

    app = await buildApp();
    setAuth();
    const res = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: auth,
      payload: { adapter: "rec", project: repo, prompt: "start" },
    });
    sessionId = res.json().id;
    expect(res.statusCode).toBe(201);

    // uncommittete Änderung: neue Zeile 6
    await writeFile(join(repo, "src-app.ts"), ["line1", "line2", "line3", "line4", "line5", "line6 neu"].join("\n") + "\n");
  });

  afterAll(async () => {
    await app.close().catch(() => undefined);
    await rm(join(repo, ".."), { recursive: true, force: true });
  });

  it("legt eine Notiz an und liefert sie mit gültigem Anker", async () => {
    const create = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/reviews`,
      headers: auth,
      payload: {
        basis: { baseRef: "HEAD", headSha, scope: { kind: "uncommitted" } },
        anchor: { path: "src-app.ts", side: "new", startLine: 6, endLine: 6, excerpt: "line6 neu" },
        text: "Bitte aussagekräftiger benennen.",
      },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().note.status).toBe("draft");

    const list = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}/reviews`, headers: auth });
    expect(list.statusCode).toBe(200);
    const items = list.json().items;
    expect(items).toHaveLength(1);
    expect(items[0].anchorState).toBe("valid");
  });

  it("Notizen überstehen einen Hub-Neustart (K7, AC-P36-1)", async () => {
    await app.close();
    app = await buildApp();
    setAuth();
    const list = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}/reviews`, headers: auth });
    expect(list.statusCode).toBe(200);
    const items = list.json().items;
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe("Bitte aussagekräftiger benennen.");
  });

  it("Sammelversand erreicht den Harness genau einmal — zweiter Klick dupliziert nicht (AC-P36-2)", async () => {
    const noteId = (await app.inject({ method: "GET", url: `/api/sessions/${sessionId}/reviews`, headers: auth })).json().items[0].id;
    const before = steered.length;
    const send = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/reviews/send`,
      headers: auth,
      payload: { noteIds: [noteId], operationId: "op-integration-0001" },
    });
    expect(send.statusCode).toBe(200);
    expect(send.json().ok).toBe(true);
    expect(send.json().prompt).toContain("Sammel-Review");
    expect(steered.length).toBe(before + 1);

    const duplicate = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/reviews/send`,
      headers: auth,
      payload: { noteIds: [noteId], operationId: "op-integration-0001" },
    });
    expect(duplicate.statusCode).toBe(200);
    expect(steered.length).toBe(before + 1); // Dedupe: kein zweiter Prompt

    const after = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}/reviews`, headers: auth });
    expect(after.json().items[0].status).toBe("sent");
  });

  it("veralteter Anker wird sichtbar und nicht versendet (AC-P36-3)", async () => {
    // Inhalt am Anker ändern (uncommittet): Ausschnitt stimmt nicht mehr
    await writeFile(join(repo, "src-app.ts"), ["line1", "line2", "line3", "line4", "line5", "völlig anders"].join("\n") + "\n");
    resetDiffCacheForTests();
    const create = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/reviews`,
      headers: auth,
      payload: {
        basis: { baseRef: "HEAD", headSha, scope: { kind: "uncommitted" } },
        anchor: { path: "src-app.ts", side: "new", startLine: 6, endLine: 6, excerpt: "line6 neu" },
        text: "Zweite Notiz am alten Stand.",
      },
    });
    expect(create.statusCode).toBe(201);
    const staleId = create.json().note.id;

    const list = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}/reviews`, headers: auth });
    const staleItem = list.json().items.find((n: { id: string }) => n.id === staleId);
    expect(staleItem.anchorState).toBe("stale");
    expect(staleItem.staleReason).toContain("nicht mehr überein");

    const send = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/reviews/send`,
      headers: auth,
      payload: { noteIds: [staleId], operationId: "op-integration-0002" },
    });
    expect(send.statusCode).toBe(422);
    expect(send.json().detail).toContain("neu verankern");
    expect(steered.length).toBe(1);

    // API-Fehler behalten Entwurf und Ursache (AC-P36-5)
    const after = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}/reviews`, headers: auth });
    const failed = after.json().items.find((n: { id: string }) => n.id === staleId);
    expect(failed.status).toBe("draft");
    expect(failed.sendDetail).toContain("neu verankern");
  });

  it("Empfänger ohne followUp wird laut abgelehnt, Empfängerwahl erreicht die Ziel-Session (AC-P36-2)", async () => {
    // Frische gültige Notiz für diesen Fall (die alte ist seit der Inhaltsänderung veraltet)
    const { stdout } = await execAsync("git", ["-C", repo, "rev-parse", "HEAD"]);
    const head = stdout.trim();
    const create = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/reviews`,
      headers: auth,
      payload: {
        basis: { baseRef: "HEAD", headSha: head, scope: { kind: "uncommitted" } },
        anchor: { path: "src-app.ts", side: "new", startLine: 6, endLine: 6, excerpt: "völlig anders" },
        text: "Empfänger-Test-Notiz.",
      },
    });
    expect(create.statusCode).toBe(201);
    const noteId = create.json().note.id;

    const norf = await app.inject({ method: "POST", url: "/api/sessions", headers: auth, payload: { adapter: "norf", project: repo } });
    expect(norf.statusCode).toBe(201);
    const refused = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/reviews/send`,
      headers: auth,
      payload: { noteIds: [noteId], targetSessionId: norf.json().id, operationId: "op-integration-0003" },
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().detail).toContain("nimmt keine weiteren Eingaben an");
    expect((await app.inject({ method: "GET", url: `/api/sessions/${sessionId}/reviews`, headers: auth })).json().items.find((n: { id: string }) => n.id === noteId).status).toBe("draft");

    const second = await app.inject({ method: "POST", url: "/api/sessions", headers: auth, payload: { adapter: "rec", project: repo } });
    expect(second.statusCode).toBe(201);
    const before = steered.length;
    const ok = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/reviews/send`,
      headers: auth,
      payload: { noteIds: [noteId], targetSessionId: second.json().id, operationId: "op-integration-0004" },
    });
    expect(ok.statusCode).toBe(200);
    expect(steered.length).toBe(before + 1);
    const last = steered.at(-1);
    expect(last?.kind).toBe("prompt");
    if (last?.kind === "prompt") expect(last.text).toContain("Empfänger-Test-Notiz");
  });

  it("Status setzen und löschen sind menschliche Operationen", async () => {    const list = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}/reviews`, headers: auth });
    const first = list.json().items.find((n: { status: string }) => n.status === "sent");
    const done = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/reviews/${first.id}/status`,
      headers: auth,
      payload: { status: "done" },
    });
    expect(done.statusCode).toBe(200);
    expect(done.json().note.status).toBe("done");

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/sessions/${sessionId}/reviews/${first.id}`,
      headers: auth,
      payload: { text: "Erledigt — erledigt markiert" },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().note.text).toContain("Erledigt");

    const remove = await app.inject({ method: "DELETE", url: `/api/sessions/${sessionId}/reviews/${first.id}`, headers: auth });
    expect(remove.statusCode).toBe(200);
    const remaining = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}/reviews`, headers: auth });
    // Erste Notiz gelöscht; die Stale-Notiz und die Empfänger-Test-Notiz bleiben.
    expect(remaining.json().items).toHaveLength(2);
  });
});
