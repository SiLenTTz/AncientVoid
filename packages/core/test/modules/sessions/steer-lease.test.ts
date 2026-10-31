import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore, HubDatabase, SessionManager, AdapterRegistry } from "../../../src/index.ts";
import { ProcessRunner } from "@ancientvoid/workers";
import { createAdapter as createDummy } from "@ancientvoid/adapter-dummy";

describe("steer idempotency and recovery honesty (AC-P5-3 / AC-P5-4)", () => {
  it("applies one input id once and rejects a stale revision or foreign lease", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-steer-"));
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

  it("T5.5: an explicit takeover moves the lease to the new device, once", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-takeover-"));
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 5, autoStopAfterEvents: 0 });
    const manager = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    try {
      const record = await manager.create({ adapter: "dummy", project: dir });
      expect((await manager.steer(record.id, { kind: "prompt", text: "vom Handy" }, "phone", { inputId: "p-1", clientId: "phone" })).ok).toBe(true);
      const blocked = await manager.steer(record.id, { kind: "prompt", text: "vom PC" }, "pc", { inputId: "d-1", clientId: "desktop" });
      expect(blocked).toEqual({ ok: false, detail: "writer lease held" });

      const taken = await manager.steer(record.id, { kind: "prompt", text: "vom PC" }, "pc", {
        inputId: "d-1",
        clientId: "desktop",
        takeover: true,
      });
      expect(taken.ok).toBe(true);
      expect(manager.get(record.id)?.writerClient).toBe("desktop");
      const again = await manager.steer(record.id, { kind: "prompt", text: "vom PC" }, "pc", {
        inputId: "d-1",
        clientId: "desktop",
        takeover: true,
      });
      expect(again).toEqual({ ok: true, detail: "duplicate input ignored" });

      const back = await manager.steer(record.id, { kind: "prompt", text: "wieder Handy" }, "phone", { inputId: "p-2", clientId: "phone" });
      expect(back).toEqual({ ok: false, detail: "writer lease held" });
      const events = await manager.tail(record.id, 0);
      const takeover = events.filter((e) => (e.payload as { kind?: string }).kind === "session.writer_takeover");
      expect(takeover.map((e) => e.payload)).toEqual([
        expect.objectContaining({ from: "phone", to: "desktop", actor: "pc" }),
      ]);
      expect(events.filter((e) => e.type === "user" && (e.payload as { text?: string }).text === "vom PC")).toHaveLength(1);
    } finally {
      await manager.shutdown();
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not call a session controllable when recover() returns null", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-rec-"));
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
