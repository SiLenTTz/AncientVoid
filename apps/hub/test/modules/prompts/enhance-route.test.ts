import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, EventStore, HubDatabase, SessionManager, TokenService } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import { createHubApp } from "../../../src/app.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function setup(chat: (body: { messages: { role: string; content: string }[] }) => Response) {
  const root = await mkdtemp(join(tmpdir(), "ancientvoid-enhance-route-"));
  const project = join(root, "demo");
  await mkdir(join(project, ".claude", "skills", "bugfix"), { recursive: true });
  await writeFile(join(project, "AGENTS.md"), "Tests: npm run test:fast");
  await writeFile(join(project, ".claude", "skills", "bugfix", "SKILL.md"), "---\nname: bugfix\ndescription: Defekt reproduzieren und fixen\n---\nBody\n");
  const db = new HubDatabase(":memory:");
  const store = new EventStore(root);
  const registry = new AdapterRegistry();
  const sessions = new SessionManager(db, store, registry, new ProcessRunner());
  const tokens = new TokenService(db);
  const token = tokens.issue("phone").token;
  const seen: { messages: { role: string; content: string }[] }[] = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).endsWith("/slots")) return Response.json([{ is_processing: false }]);
    const body = JSON.parse(String(init?.body)) as { messages: { role: string; content: string }[] };
    seen.push(body);
    return chat(body);
  }) as typeof fetch;
  const app = await createHubApp({
    sessions,
    tokens,
    registry,
    auth: { tokens, enforceTailnetIdentity: false },
    projectRoots: [root],
    assistantModel: { url: "http://127.0.0.1:9/v1", model: "qwen3-coder", fetch: fakeFetch },
  });
  cleanups.push(async () => {
    await app.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });
  return { app, project, seen, headers: { authorization: `Bearer ${token}` } };
}

describe("POST /api/prompt-enhance with a local model (EPIC-P68)", () => {
  it("answers from the local model with the project context in the system message", async () => {
    const { app, project, seen, headers } = await setup(() => Response.json({ choices: [{ message: { content: "Ziel: schneller Login" } }] }));
    const res = await app.inject({ method: "POST", url: "/api/prompt-enhance", headers, payload: { adapter: "aider", text: "login schneller", project } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ enhanced: "Ziel: schneller Login", engine: { kind: "local", model: "qwen3-coder" }, skipped: [] });
    const system = seen[0]!.messages[0]!.content;
    expect(system).toContain("Tests: npm run test:fast");
    expect(system).toContain("- skill bugfix — Defekt reproduzieren und fixen");
  });

  it("502 names every stage when local is busy and the fallback fails", async () => {
    const { app, project, headers } = await setup(() => new Response("", { status: 503 }));
    const prev = process.env.PATH;
    process.env.PATH = ""; // no real opencode/claude on the way
    try {
      const res = await app.inject({ method: "POST", url: "/api/prompt-enhance", headers, payload: { adapter: "claude", text: "x", project } });
      expect(res.statusCode).toBe(502);
      const body = res.json() as { error: string; skipped: { engine: string; reason: string }[] };
      expect(body.skipped[0]).toEqual({ engine: "Lokales Modell (qwen3-coder)", reason: "ausgelastet (HTTP 503)" });
      expect(body.skipped[1]!.engine).toBe("Claude");
    } finally {
      process.env.PATH = prev;
    }
  });
});
