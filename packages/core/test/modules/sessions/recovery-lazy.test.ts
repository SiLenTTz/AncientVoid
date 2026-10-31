import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NormalizedEvent } from "@ancientvoid/contracts";
import { EventStore, HubDatabase, SessionManager, AdapterRegistry } from "../../../src/index.ts";
import { ProcessRunner } from "@ancientvoid/workers";
import { createAdapter as createDummy } from "@ancientvoid/adapter-dummy";

class CountingStore extends EventStore {
  replays = 0;
  override async replay(sessionId: string): Promise<NormalizedEvent[]> {
    this.replays++;
    return super.replay(sessionId);
  }
}

async function hubWithStoppedSession(register = true) {
  const dir = await mkdtemp(join(tmpdir(), "ancientvoid-lazy-"));
  const dbFile = join(dir, "hub.db");
  const firstDb = new HubDatabase(dbFile);
  const firstRegistry = new AdapterRegistry();
  firstRegistry.register("dummy", createDummy, { eventsPerSecond: 5, autoStopAfterEvents: 0 });
  const first = new SessionManager(firstDb, new EventStore(dir), firstRegistry, new ProcessRunner());
  const record = await first.create({ adapter: "dummy", project: dir, prompt: "a" });
  await first.stop(record.id);
  await first.shutdown();
  firstDb.close();

  const db = new HubDatabase(dbFile);
  const store = new CountingStore(dir);
  const registry = new AdapterRegistry();
  if (register) registry.register("dummy", createDummy, { eventsPerSecond: 5, autoStopAfterEvents: 0 });
  const manager = new SessionManager(db, store, registry, new ProcessRunner());
  const cleanup = async () => {
    await manager.shutdown();
    db.close();
    await rm(dir, { recursive: true, force: true });
  };
  return { manager, store, id: record.id, cleanup };
}

describe("stopped sessions load on open, not at recovery (BUG-0018, K7)", () => {
  it("recoverAll does not replay stopped sessions", async () => {
    const hub = await hubWithStoppedSession();
    try {
      const result = await hub.manager.recoverAll();
      expect(result.recovered).toBe(1);
      expect(hub.store.replays).toBe(0);
      expect(hub.manager.sessionCounts().live).toBe(0);
    } finally {
      await hub.cleanup();
    }
  });

  it("an open view of a stopped session sees the continued run", async () => {
    const hub = await hubWithStoppedSession();
    try {
      await hub.manager.recoverAll();
      const seen: NormalizedEvent[] = [];
      const unsubscribe = hub.manager.subscribe(hub.id, (events) => seen.push(...events));
      const ack = await hub.manager.steer(hub.id, { kind: "prompt", text: "weiter" });
      expect(ack.ok).toBe(true);
      expect(seen.some((e) => (e.payload as { kind?: string }).kind === "session.continued")).toBe(true);
      unsubscribe();
    } finally {
      await hub.cleanup();
    }
  });

  it("a stopped session whose adapter is gone says so instead of crashing", async () => {
    const hub = await hubWithStoppedSession(false);
    try {
      await hub.manager.recoverAll();
      const ack = await hub.manager.steer(hub.id, { kind: "prompt", text: "weiter" });
      expect(ack).toEqual({ ok: false, detail: 'adapter "dummy" not registered' });
      expect(hub.manager.get(hub.id)?.status).toBe("stopped");
    } finally {
      await hub.cleanup();
    }
  });
});
