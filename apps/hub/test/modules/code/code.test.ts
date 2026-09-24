import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, EventStore, HubDatabase, SessionManager, TokenService } from "@uacc/core";
import { createAdapter as createDummy } from "@uacc/adapter-dummy";
import { ProcessRunner } from "@uacc/workers";
import type { FastifyInstance } from "fastify";
import { createHubApp } from "../../../src/app.ts";

/** T7.6: code search, viewer and registered actions over HTTP. */
describe("code routes (T7.6)", () => {
  let dir: string;
  let project: string;
  let app: FastifyInstance;
  let sessions: SessionManager;
  let human: string;
  let agent: string;

  async function call(method: "GET" | "POST", url: string, token: string, payload?: unknown) {
    const res = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });
    return { status: res.statusCode, body: res.json() as Record<string, unknown> };
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "uacc-code-routes-"));
    project = join(dir, "proj");
    await mkdir(join(project, "src"), { recursive: true });
    await writeFile(join(project, "src/app.ts"), "export function startServer(port: number) {\n  return port;\n}\n");
    await writeFile(join(project, "werkzeug.py"), "def lade_daten(pfad):\n    return pfad\n");
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: project });
    execFileSync("git", ["add", "-A"], { cwd: project });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: project });
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 1, autoStopAfterEvents: 0 });
    const tokens = new TokenService(db);
    sessions = new SessionManager(db, new EventStore(join(dir, "data")), registry, new ProcessRunner());
    app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false }, projectRoots: [dir], dataDir: join(dir, "data") });
    human = tokens.issue("pixel").token;
    agent = tokens.issue("agent:mcp").token;
  });

  afterEach(async () => {
    await sessions.shutdown();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("finds a function in .ts and .py with its line, and opens the file at that anchor", async () => {
    const s = await sessions.create({ adapter: "dummy", project });
    const ts = await call("GET", `/api/code/search?session=${s.id}&q=startServer&mode=symbol`, human);
    expect(ts.status).toBe(200);
    expect((ts.body.matches as unknown[])[0]).toMatchObject({ path: "src/app.ts", line: 1, kind: "definition" });
    expect(ts.body.identity).toMatchObject({ kind: "session", sessionId: s.id, branch: "main" });
    const py = await call("GET", `/api/code/search?project=${encodeURIComponent(project)}&q=lade_daten&mode=symbol`, agent);
    expect((py.body.matches as unknown[])[0]).toMatchObject({ path: "werkzeug.py", line: 1 });
    const file = await call("GET", `/api/code/file?session=${s.id}&path=werkzeug.py`, human);
    expect(file.body).toMatchObject({ path: "werkzeug.py", language: "python", lines: 2, changed: null });
  });

  it("refuses paths outside the workspace and projects outside projectRoots", async () => {
    const s = await sessions.create({ adapter: "dummy", project });
    expect((await call("GET", `/api/code/file?session=${s.id}&path=../../etc/passwd`, human)).status).toBe(404);
    expect((await call("GET", `/api/code/search?project=/etc&q=root`, human)).status).toBe(422);
    expect((await call("GET", `/api/code/search?session=${s.id}&q=a.b(&mode=symbol`, human)).status).toBe(422);
  });

  it("a human runs a registered action; an agent may list but not run it", async () => {
    const s = await sessions.create({ adapter: "dummy", project });
    const list = await call("GET", `/api/sessions/${s.id}/actions`, agent);
    expect((list.body.actions as { id: string }[]).map((a) => a.id)).toEqual(["git-status", "git-log", "git-diff-stat"]);
    expect((await call("POST", `/api/sessions/${s.id}/actions/git-status`, agent, {})).status).toBe(403);
    const started = await call("POST", `/api/sessions/${s.id}/actions/git-status`, human, {});
    expect(started.status).toBe(202);
    const runId = started.body.id as string;
    let run = started.body;
    for (let i = 0; i < 100 && run.status === "running"; i++) {
      await new Promise((r) => setTimeout(r, 50));
      run = (await call("GET", `/api/sessions/${s.id}/actions/runs/${runId}`, human)).body;
    }
    expect(run).toMatchObject({ status: "succeeded", exitCode: 0, actor: "pixel" });
    expect(run.output).toContain("## main");
    const events = await sessions.tail(s.id, 0);
    expect(events.find((e) => e.type === "tool_use" && (e.payload as { name?: string }).name === "aktion:git-status")).toBeTruthy();
    expect((await call("POST", `/api/sessions/${s.id}/actions/gibts-nicht`, human, {})).status).toBe(404);
  });
});
