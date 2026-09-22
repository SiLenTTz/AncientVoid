import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, EventStore, HubDatabase, SessionManager, TokenService } from "@uacc/core";
import { ProcessRunner } from "@uacc/workers";
import { createHubApp } from "../src/index.ts";

describe("prompt recommendation", () => {
  it("matches a project skill, proposes a file when nothing fits, and writes it once", async () => {
    const root = await mkdtemp(join(tmpdir(), "uacc-reco-"));
    const project = join(root, "demo");
    await mkdir(join(project, ".claude", "skills", "bugfix"), { recursive: true });
    await writeFile(
      join(project, ".claude", "skills", "bugfix", "SKILL.md"),
      "---\nname: bugfix\ndescription: Defekt reproduzieren und fixen\n---\n",
    );
    const db = new HubDatabase(":memory:");
    const store = new EventStore(root);
    const registry = new AdapterRegistry();
    const sessions = new SessionManager(db, store, registry, new ProcessRunner());
    const tokens = new TokenService(db);
    const token = tokens.issue("phone").token;
    const app = await createHubApp({
      sessions,
      tokens,
      registry,
      auth: { tokens, enforceTailnetIdentity: false },
      projectRoots: [root],
    });
    const headers = { authorization: `Bearer ${token}` };
    try {
      const match = await app.inject({
        method: "POST",
        url: "/api/prompt-recommendation",
        headers,
        payload: { project, text: "Bitte den Defekt reproduzieren und fixen" },
      });
      expect(match.statusCode).toBe(200);
      expect(match.json()).toMatchObject({ mode: "match", kind: "skill", name: "bugfix" });

      const empty = join(root, "empty");
      await mkdir(empty);
      const created = await app.inject({
        method: "POST",
        url: "/api/prompt-recommendation",
        headers,
        payload: { project: empty, text: "Baue ein Neon-Tetris" },
      });
      expect(created.statusCode).toBe(200);
      const body = created.json() as { mode: string; name: string; draft: string; description: string; kind: string };
      expect(body.mode).toBe("create");
      expect(body.kind).toBe("skill");

      const outside = await mkdtemp(join(tmpdir(), "uacc-reco-out-"));
      const denied = await app.inject({
        method: "POST",
        url: "/api/prompt-recommendation",
        headers,
        payload: { project: outside, text: "Baue ein Neon-Tetris" },
      });
      expect(denied.statusCode).toBe(422);

      const saved = await app.inject({
        method: "POST",
        url: "/api/skills",
        headers,
        payload: { project: empty, kind: body.kind, name: body.name, description: body.description, draft: body.draft },
      });
      expect(saved.statusCode).toBe(201);
      const written = await readFile(join(empty, ".claude", "skills", body.name, "SKILL.md"), "utf8");
      expect(written).toContain(`name: ${body.name}`);
      const again = await app.inject({
        method: "POST",
        url: "/api/skills",
        headers,
        payload: { project: empty, kind: body.kind, name: body.name, description: body.description, draft: body.draft },
      });
      expect(again.statusCode).toBe(409);
      await rm(outside, { recursive: true, force: true });
    } finally {
      await sessions.shutdown().catch(() => undefined);
      await app.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });
});
