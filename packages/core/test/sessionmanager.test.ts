import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore } from "../src/eventstore.ts";
import { SessionManager } from "../src/sessionmanager.ts";
import { AdapterRegistry } from "../src/registry.ts";
import { HubDatabase } from "../src/db.ts";
import { ProcessRunner } from "@uacc/workers";
import { createAdapter as createDummy } from "@uacc/adapter-dummy";

function makeManager(dir: string, dummyConfig?: Record<string, unknown>, dbFile?: string) {
  const db = new HubDatabase(dbFile ? join(dir, dbFile) : ":memory:");
  const store = new EventStore(dir);
  const registry = new AdapterRegistry();
  registry.register("dummy", createDummy, dummyConfig);
  const manager = new SessionManager(db, store, registry, new ProcessRunner());
  return { manager, store, db };
}

/**
 * Poll instead of a fixed sleep: the dummy adapter's setInterval firing is
 * wall-clock-real, and under load its actual cadence can fall well behind
 * the nominal `1000 / eventsPerSecond` rate. A fixed sleep races that
 * drift; polling with a generous ceiling doesn't.
 */
async function waitFor(check: () => Promise<boolean>, timeoutMs = 12_000, stepMs = 20): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  if (!(await check())) throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
}

describe("SessionManager", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "uacc-sm-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates a session, persists it and emits lifecycle events", async () => {
    const { manager } = makeManager(dir, { eventsPerSecond: 20, autoStopAfterEvents: 5 });
    try {
      const record = await manager.create({ adapter: "dummy", project: dir });
      expect(record.id).toBeTruthy();
      expect(record.status).toBe("working");
      await waitFor(async () => {
        const events = await manager.tail(record.id, 0);
        return events.filter((e) => e.type !== "system").length >= 5;
      });
      const events = await manager.tail(record.id, 0);
      const kinds = events.map((e) => (e.payload as { kind?: string }).kind);
      expect(kinds).toContain("session.created");
      expect(kinds).toContain("session.started");
      expect(events.filter((e) => e.type !== "system").length).toBeGreaterThanOrEqual(5);
    } finally {
      // BUG-0002: a thrown assertion above must never skip this. The dummy
      // adapter's generator is a real setInterval — an un-stopped one keeps
      // firing (and, once its temp dir is gone, keeps failing) for the rest
      // of the process, since vitest runs this whole suite in one fork.
      await manager.shutdown();
    }
  });

  it("rejects unknown adapters loudly", async () => {
    const { manager } = makeManager(dir);
    await expect(manager.create({ adapter: "nope", project: dir })).rejects.toThrow(/unknown adapter/);
  });

  it("stops a session cleanly (status stopped, events persisted)", async () => {
    const { manager } = makeManager(dir, { eventsPerSecond: 10 });
    try {
      const record = await manager.create({ adapter: "dummy", project: dir });
      await new Promise((r) => setTimeout(r, 200));
      const ack = await manager.stop(record.id);
      expect(ack.ok).toBe(true);
      expect(manager.get(record.id)!.status).toBe("stopped");
    } finally {
      await manager.shutdown();
    }
  });

  it("steer prompts flow through the adapter", async () => {
    const { manager } = makeManager(dir, { eventsPerSecond: 5 });
    try {
      const record = await manager.create({ adapter: "dummy", project: dir });
      const ack = await manager.steer(record.id, { kind: "prompt", text: "hallo" });
      expect(ack.ok).toBe(true);
      const events = await manager.tail(record.id, 0);
      expect(events.some((e) => e.type === "user" && e.summary.includes("hallo"))).toBe(true);
    } finally {
      await manager.shutdown();
    }
  });

  it("records start failures as session.start_failed + status error", async () => {
    const { manager } = makeManager(dir, { failStart: true });
    try {
      const record = await manager.create({ adapter: "dummy", project: dir });
      expect(record.status).toBe("error");
      const events = await manager.tail(record.id, 0);
      expect(events.some((e) => (e.payload as { kind?: string }).kind === "session.start_failed")).toBe(true);
    } finally {
      await manager.shutdown();
    }
  });

  it("subscribers receive live event batches", async () => {
    const { manager } = makeManager(dir, { eventsPerSecond: 30 });
    try {
      const record = await manager.create({ adapter: "dummy", project: dir });
      const seen: number[] = [];
      manager.subscribe(record.id, (events) => seen.push(...events.map((e) => e.seq)));
      await new Promise((r) => setTimeout(r, 500));
      expect(seen.length).toBeGreaterThan(3);
    } finally {
      await manager.shutdown();
    }
  });

  it("K7 (AC-P0-1): recovers 5 concurrent sessions, byte-identical, restore < 3s", async () => {
    const SESSION_COUNT = 5;
    const first = makeManager(dir, { eventsPerSecond: 20, autoStopAfterEvents: 10 }, "k7-5.db");
    let secondManager: SessionManager | undefined;
    try {
      const records = await Promise.all(
        Array.from({ length: SESSION_COUNT }, () => first.manager.create({ adapter: "dummy", project: dir })),
      );

      // Wait for every session's own stop signal instead of a fixed sleep —
      // see BUG-0001: a sleep-then-snapshot race lets a straggling event
      // land between the "before" read below and the hard cut.
      await waitFor(async () => {
        for (const record of records) {
          const events = await first.manager.tail(record.id, 0);
          if (!events.some((e) => e.type === "system" && e.summary === "dummy: auto-stop reached")) return false;
        }
        return true;
      });
      await first.store.flush();

      const eventsBefore = new Map<string, number>();
      for (const record of records) {
        const count = (await first.manager.tail(record.id, 0)).length;
        expect(count).toBeGreaterThan(5);
        eventsBefore.set(record.id, count);
      }

      // Hard cut: no graceful shutdown of `first` — new manager instance
      // must restore state from the SAME on-disk artifacts (sqlite + jsonl
      // + snapshot) for all 5 sessions at once. Each session's generator
      // already self-stopped above (autoStopAfterEvents), so none needs
      // cleanup here.
      const second = makeManager(dir, { eventsPerSecond: 20 }, "k7-5.db");
      secondManager = second.manager;
      const t0 = performance.now();
      const { recovered } = await second.manager.recoverAll();
      const elapsedMs = performance.now() - t0;

      // AC-P0-1 as a real assertion, not the console.warn sessionmanager.ts
      // itself falls back to — a restore that's merely logged as slow was
      // never actually gated on the "< 3 s" requirement.
      expect(recovered).toBeGreaterThanOrEqual(SESSION_COUNT);
      expect(elapsedMs).toBeLessThan(3000);

      for (const record of records) {
        const before = eventsBefore.get(record.id)!;
        const eventsAfter = await second.manager.tail(record.id, 0);
        // Pre-crash stream is preserved byte-identically …
        expect(eventsAfter.slice(0, before).map((e) => e.seq)).toEqual(
          Array.from({ length: before }, (_, i) => i + 1),
        );
        // … and recovery may only append audit events after it.
        expect(eventsAfter.length).toBeGreaterThanOrEqual(before);
        expect(eventsAfter.slice(before).every((e) => e.type === "system")).toBe(true);
      }
    } finally {
      // BUG-0002: `recover()` restarts each dummy generator with
      // `autoStopAfterEvents` defaulting to 0 (endless). If any expect()
      // above throws, this used to be skipped, leaving up to 5 infinite,
      // unref'd setIntervals running for the rest of the whole test
      // process (all files share one fork).
      await secondManager?.shutdown();
    }
  });
});
