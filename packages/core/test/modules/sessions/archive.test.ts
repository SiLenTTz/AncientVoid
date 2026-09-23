import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, EventStore, HubDatabase, SessionManager } from "../../../src/index.ts";
import { ProcessRunner } from "@uacc/workers";
import { createAdapter as createDummy } from "@uacc/adapter-dummy";

describe("setArchived", () => {
  it("keeps the flag across a later read and does not drop the session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uacc-arch-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 1, autoStopAfterEvents: 1 });
    const manager = new SessionManager(db, store, registry, new ProcessRunner());
    try {
      const created = await manager.create({ adapter: "dummy", project: dir });
      expect(created.archived).toBe(false);
      const archived = manager.setArchived(created.id, true);
      expect(archived.archived).toBe(true);
      expect(manager.get(created.id)?.archived).toBe(true);
      expect(manager.list().some((session) => session.id === created.id)).toBe(true);
      expect(manager.setArchived(created.id, false).archived).toBe(false);
    } finally {
      await manager.shutdown().catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
