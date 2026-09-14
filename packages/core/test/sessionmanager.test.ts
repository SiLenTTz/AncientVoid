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
 * wall-clock-real, and under parallel-test CPU load its actual cadence can
 * fall well behind the nominal `1000 / eventsPerSecond` rate. A fixed sleep
 * races that drift; polling with a generous ceiling doesn't.
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
    await manager.shutdown();
  });

  it("rejects unknown adapters loudly", async () => {
    const { manager } = makeManager(dir);
    await expect(manager.create({ adapter: "nope", project: dir })).rejects.toThrow(/unknown adapter/);
  });

  it("stops a session cleanly (status stopped, events persisted)", async () => {
    const { manager } = makeManager(dir, { eventsPerSecond: 10 });
    const record = await manager.create({ adapter: "dummy", project: dir });
    await new Promise((r) => setTimeout(r, 200));
    const ack = await manager.stop(record.id);
    expect(ack.ok).toBe(true);
    expect(manager.get(record.id)!.status).toBe("stopped");
    await manager.shutdown();
  });

  it("steer prompts flow through the adapter", async () => {
    const { manager } = makeManager(dir, { eventsPerSecond: 5 });
    const record = await manager.create({ adapter: "dummy", project: dir });
    const ack = await manager.steer(record.id, { kind: "prompt", text: "hallo" });
    expect(ack.ok).toBe(true);
    const events = await manager.tail(record.id, 0);
    expect(events.some((e) => e.type === "user" && e.summary.includes("hallo"))).toBe(true);
    await manager.shutdown();
  });

  it("records start failures as session.start_failed + status error", async () => {
    const { manager } = makeManager(dir, { failStart: true });
    const record = await manager.create({ adapter: "dummy", project: dir });
    expect(record.status).toBe("error");
    const events = await manager.tail(record.id, 0);
    expect(events.some((e) => (e.payload as { kind?: string }).kind === "session.start_failed")).toBe(true);
  });

  it("subscribers receive live event batches", async () => {
    const { manager } = makeManager(dir, { eventsPerSecond: 30 });
    const record = await manager.create({ adapter: "dummy", project: dir });
    const seen: number[] = [];
    manager.subscribe(record.id, (events) => seen.push(...events.map((e) => e.seq)));
    await new Promise((r) => setTimeout(r, 500));
    expect(seen.length).toBeGreaterThan(3);
    await manager.shutdown();
  });

  it("K7: recovers sessions with identical event count after hard restart", async () => {
    const first = makeManager(dir, { eventsPerSecond: 20, autoStopAfterEvents: 10 }, "k7.db");
    const record = await first.manager.create({ adapter: "dummy", project: dir });
    // Wait for the generator's own stop signal instead of a fixed sleep: a
    // sleep-then-snapshot race lets a straggling event land between the
    // "before" read below and the hard cut, which then shows up as an extra
    // seq in the recovered stream and breaks the byte-identity assertion
    // further down (BUG-0001).
    await waitFor(async () => {
      const events = await first.manager.tail(record.id, 0);
      return events.some((e) => e.type === "system" && e.summary === "dummy: auto-stop reached");
    });
    await first.store.flush(record.id);
    const eventsBefore = (await first.manager.tail(record.id, 0)).length;
    expect(eventsBefore).toBeGreaterThan(5);
    // Hard cut: no graceful shutdown — new manager instance must restore state
    // from the SAME on-disk artifacts (sqlite + jsonl + snapshot).
    const second = makeManager(dir, { eventsPerSecond: 20 }, "k7.db");
    const { recovered } = await second.manager.recoverAll();
    expect(recovered).toBeGreaterThanOrEqual(1);
    const eventsAfter = await second.manager.tail(record.id, 0);
    // Pre-crash stream is preserved byte-identically …
    expect(eventsAfter.slice(0, eventsBefore).map((e) => e.seq)).toEqual(
      Array.from({ length: eventsBefore }, (_, i) => i + 1),
    );
    // … and recovery may only append audit events after it.
    expect(eventsAfter.length).toBeGreaterThanOrEqual(eventsBefore);
    const appended = eventsAfter.slice(eventsBefore);
    expect(appended.every((e) => e.type === "system")).toBe(true);
    await second.manager.shutdown();
  });
});
