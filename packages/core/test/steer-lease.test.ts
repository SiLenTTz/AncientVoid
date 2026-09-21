import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore, HubDatabase, SessionManager, AdapterRegistry } from "../src/index.ts";
import { ProcessRunner } from "@uacc/workers";
import { createAdapter as createDummy } from "@uacc/adapter-dummy";

describe("steer idempotency and recovery honesty (AC-P5-3 / AC-P5-4)", () => {
  it("applies one input id once and rejects a stale revision or foreign lease", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uacc-steer-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 5, autoStopAfterEvents: 0 });
    const manager = new SessionManager(db, store, registry, new ProcessRunner());
    try {
      const record = await manager.create({ adapter: "dummy", project: dir });
      const first = await manager.steer(record.id, { kind: "prompt", text: "once" }, "phone", {
        inputId: "in-1",
        revision: 0,
        clientId: "phone",
      });
      expect(first.ok).toBe(true);
      const again = await manager.steer(record.id, { kind: "prompt", text: "once" }, "phone", {
        inputId: "in-1",
        revision: 1,
        clientId: "phone",
      });
      expect(again).toEqual({ ok: true, detail: "duplicate input ignored" });
      const userEvents = (await manager.tail(record.id, 0)).filter((event) => event.type === "user");
      expect(userEvents).toHaveLength(1);

      const conflict = await manager.steer(record.id, { kind: "prompt", text: "other" }, "desktop", {
        inputId: "in-2",
        revision: 0,
        clientId: "phone",
      });
      expect(conflict.ok).toBe(false);
      expect(conflict.detail).toMatch(/revision conflict/);

      const leased = await manager.steer(record.id, { kind: "prompt", text: "other" }, "desktop", {
        inputId: "in-3",
        revision: 1,
        clientId: "desktop",
      });
      expect(leased.ok).toBe(false);
      expect(leased.detail).toMatch(/writer lease held/);
    } finally {
      await manager.shutdown();
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not call a session controllable when recover() returns null", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uacc-rec-"));
    const dbFile = join(dir, "hub.db");
    const firstDb = new HubDatabase(dbFile);
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { resumeOnRecover: false, eventsPerSecond: 5, autoStopAfterEvents: 0 });
    const first = new SessionManager(firstDb, store, registry, new ProcessRunner());
    const record = await first.create({ adapter: "dummy", project: dir });
    expect(record.controlMode).toBe("managed");

    const secondDb = new HubDatabase(dbFile);
    const secondRegistry = new AdapterRegistry();
    secondRegistry.register("dummy", createDummy, { resumeOnRecover: false, eventsPerSecond: 5 });
    const second = new SessionManager(secondDb, new EventStore(dir), secondRegistry, new ProcessRunner());
    try {
      const result = await second.recoverAll();
      expect(result.uncontrolled).toBeGreaterThanOrEqual(1);
      expect(second.get(record.id)?.controlMode).toBe("observed");
      expect(result.reaped).not.toContain(record.id);
    } finally {
      await second.shutdown();
      await first.shutdown().catch(() => undefined);
      secondDb.close();
      firstDb.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
