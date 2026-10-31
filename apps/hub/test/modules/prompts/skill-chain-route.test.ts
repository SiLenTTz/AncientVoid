import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, EventStore, HubDatabase, SessionManager, TokenService } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import { createAdapter as createDummy } from "@ancientvoid/adapter-dummy";
import { createHubApp } from "../../../src/app.ts";

describe("skill chain on session start (BUG-0021, T5.10)", () => {
  it("loads the base catalog even when nobody listed skills before", async () => {
    const root = await mkdtemp(join(tmpdir(), "ancientvoid-chain-route-"));
    const project = join(root, "alpha");
    await mkdir(join(project, ".claude", "skills", "neon"), { recursive: true });
    await writeFile(
      join(project, ".claude", "skills", "neon", "SKILL.md"),
      "---\nname: neon\ndescription: Neon\nextends: task\n---\nNeonfarben.\n",
    );
    const db = new HubDatabase(":memory:");
    const store = new EventStore(join(root, "data"));
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 1, autoStopAfterEvents: 1 });
    const sessions = new SessionManager(db, store, registry, new ProcessRunner());
    const tokens = new TokenService(db);
    const token = tokens.issue("phone").token;
    const app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false }, projectRoots: [root] });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/sessions",
        headers: { authorization: `Bearer ${token}` },
        payload: { adapter: "dummy", project, prompt: "bunt", args: { skill: "neon" } },
      });
      expect(res.statusCode).toBe(201);
      const events = await sessions.tail((res.json() as { id: string }).id, 0);
      const chain = events.find((e) => (e.payload as { kind?: string }).kind === "session.skill_chain");
      expect(chain?.summary).toBe("Skills task → neon");
    } finally {
      await sessions.shutdown();
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
