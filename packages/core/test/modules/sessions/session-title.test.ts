import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore, HubDatabase, SessionManager, AdapterRegistry, sessionTitle } from "../../../src/index.ts";
import { ProcessRunner } from "@uacc/workers";
import { createAdapter as createDummy } from "@uacc/adapter-dummy";

describe("session titles for the overview", () => {
  it("takes the first line that says something", () => {
    expect(sessionTitle("Workflow: release\n\nBaue das Login")).toBe("Baue das Login");
    expect(sessionTitle("/neon\n\nMach es bunt\nmehr Text")).toBe("Mach es bunt");
    expect(sessionTitle("Ziel: Tetris für Mobile\nScope: x")).toBe("Tetris für Mobile");
    expect(sessionTitle("   \n")).toBeNull();
    expect(sessionTitle("x".repeat(120))?.length).toBe(80);
  });

  it("stores it with the session and survives a restart; a first reply fills an empty one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uacc-title-"));
    const dbFile = join(dir, "hub.db");
    const db = new HubDatabase(dbFile);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 5, autoStopAfterEvents: 0 });
    const manager = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    try {
      const withPrompt = await manager.create({ adapter: "dummy", project: dir, prompt: "Baue ein Tetris" });
      expect(withPrompt.title).toBe("Baue ein Tetris");
      const empty = await manager.create({ adapter: "dummy", project: dir });
      expect(empty.title).toBeNull();
      await manager.steer(empty.id, { kind: "prompt", text: "Jetzt die Tests" });
      expect(manager.get(empty.id)?.title).toBe("Jetzt die Tests");
      await manager.shutdown();
      const reopened = new HubDatabase(dbFile);
      const again = new SessionManager(reopened, new EventStore(dir), registry, new ProcessRunner());
      expect(again.get(withPrompt.id)?.title).toBe("Baue ein Tetris");
      reopened.close();
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
