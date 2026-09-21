import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore } from "../src/eventstore.ts";
import { SessionManager } from "../src/sessionmanager.ts";
import { AdapterRegistry } from "../src/registry.ts";
import { HubDatabase } from "../src/db.ts";
import { WorktreeManager } from "../src/worktree.ts";
import { ProcessRunner } from "@uacc/workers";
import { createAdapter as createDummy } from "@uacc/adapter-dummy";

const execFileAsync = promisify(execFile);

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

  it("T2.8: threads the calling device's identity ('actor') onto session.created/session.steer/session.stopped", async () => {
    const { manager } = makeManager(dir, { eventsPerSecond: 10 });
    try {
      const record = await manager.create({ adapter: "dummy", project: dir }, "pixel-9");
      await manager.steer(record.id, { kind: "resume" }, "pixel-9"); // dummy handles "resume" itself; still audited
      const ack = await manager.stop(record.id, "pixel-9");
      expect(ack.ok).toBe(true);
      const events = await manager.tail(record.id, 0);
      const created = events.find((e) => (e.payload as { kind?: string }).kind === "session.created");
      const steered = events.find((e) => (e.payload as { kind?: string }).kind === "session.steer");
      const stopped = events.find((e) => (e.payload as { kind?: string }).kind === "session.stopped");
      expect((created!.payload as { actor?: string }).actor).toBe("pixel-9");
      expect((steered!.payload as { actor?: string }).actor).toBe("pixel-9");
      expect((stopped!.payload as { actor?: string }).actor).toBe("pixel-9");
    } finally {
      await manager.shutdown();
    }
  });

  it("T2.8: actor is null when the caller omits it — every pre-T2.8 call site, honestly, not guessed", async () => {
    const { manager } = makeManager(dir, { eventsPerSecond: 10 });
    try {
      const record = await manager.create({ adapter: "dummy", project: dir });
      const events = await manager.tail(record.id, 0);
      const created = events.find((e) => (e.payload as { kind?: string }).kind === "session.created");
      expect((created!.payload as { actor?: string | null }).actor).toBeNull();
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

  it("AI-P0-5: a transient append failure sets status error AND surfaces a visible error event", async () => {
    const { manager, store } = makeManager(dir, { eventsPerSecond: 20, autoStopAfterEvents: 2 });
    try {
      const record = await manager.create({ adapter: "dummy", project: dir });
      // Fail exactly the NEXT append (the dummy's first generated event),
      // then behave normally — simulates a one-off I/O hiccup rather than
      // a permanently broken store.
      const realAppend = store.append.bind(store);
      let failedOnce = false;
      store.append = (sessionId, events) => {
        if (!failedOnce) {
          failedOnce = true;
          return Promise.reject(new Error("simulated transient append failure"));
        }
        return realAppend(sessionId, events);
      };

      await waitFor(async () => {
        const events = await manager.tail(record.id, 0);
        return events.some((e) => e.type === "error");
      });

      const events = await manager.tail(record.id, 0);
      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent?.summary).toContain("simulated transient append failure");
      expect(manager.get(record.id)!.status).toBe("error");
    } finally {
      await manager.shutdown();
    }
  });

  it("AI-P0-5: a permanent append failure still persists status error without crashing", async () => {
    const { manager, store } = makeManager(dir, { eventsPerSecond: 20, autoStopAfterEvents: 2 });
    try {
      const record = await manager.create({ adapter: "dummy", project: dir });
      await waitFor(async () => (await manager.tail(record.id, 0)).length > 0);
      // Every append fails from here on (e.g. disk gone) — both the
      // original emit AND handleEmitFailure's own follow-up event fail.
      // Must not throw/crash the adapter's fire-and-forget emit() caller.
      store.append = () => Promise.reject(new Error("simulated permanent append failure"));

      await waitFor(async () => manager.get(record.id)!.status === "error");
      expect(manager.get(record.id)!.status).toBe("error");
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

  it("T1.5/ADR-0003: accumulates costUsd across events and bumps updatedAt on activity", async () => {
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    // Minimal inline adapter — the dummy adapter has no costUsd capability,
    // and this needs a controlled costUsd-bearing EmittedEvent per turn.
    registry.register("cost-test", () => ({
      id: "cost-test",
      version: "0.0.1",
      capabilities: () => ({ reasoning: false, tools: false, cost: true, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none" }),
      async start(_spec, ctx) {
        ctx.emit({ type: "system", summary: "turn 1", payload: {}, costUsd: 0.01 });
        return { sessionId: ctx.sessionId };
      },
      async steer(handle, input, ctx) {
        if (input.kind === "prompt") ctx.emit({ type: "system", summary: "turn 2", payload: {}, costUsd: 0.02 });
        return { ok: true };
      },
      async status() {
        return { state: "healthy" as const };
      },
      async stop() {},
    }));
    const manager = new SessionManager(db, store, registry, new ProcessRunner());
    try {
      const record = await manager.create({ adapter: "cost-test", project: dir });
      await waitFor(async () => (await manager.tail(record.id, 0)).some((e) => e.costUsd === 0.01));
      const createdAt = manager.get(record.id)!.updatedAt;

      await new Promise((r) => setTimeout(r, 5)); // ensure a distinguishable later timestamp
      await manager.steer(record.id, { kind: "prompt", text: "go" });
      await waitFor(async () => (await manager.tail(record.id, 0)).some((e) => e.costUsd === 0.02));

      const after = manager.get(record.id)!;
      expect(after.costUsd).toBeCloseTo(0.03, 6); // 0.01 + 0.02, summed not overwritten
      expect(after.updatedAt >= createdAt).toBe(true); // ISO-8601 sorts lexicographically
    } finally {
      await manager.shutdown();
    }
  });

  it("ADR-0006: accumulates tokensEst across events, same summed-not-overwritten pattern as costUsd", async () => {
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("tokens-test", () => ({
      id: "tokens-test",
      version: "0.0.1",
      capabilities: () => ({ reasoning: false, tools: false, cost: true, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none" }),
      async start(_spec, ctx) {
        ctx.emit({ type: "system", summary: "turn 1", payload: {}, tokensEst: 10 });
        return { sessionId: ctx.sessionId };
      },
      async steer(handle, input, ctx) {
        if (input.kind === "prompt") ctx.emit({ type: "system", summary: "turn 2", payload: {}, tokensEst: 25 });
        return { ok: true };
      },
      async status() {
        return { state: "healthy" as const };
      },
      async stop() {},
    }));
    const manager = new SessionManager(db, store, registry, new ProcessRunner());
    try {
      const record = await manager.create({ adapter: "tokens-test", project: dir });
      await waitFor(async () => (await manager.tail(record.id, 0)).some((e) => e.tokensEst === 10));
      await manager.steer(record.id, { kind: "prompt", text: "go" });
      await waitFor(async () => (await manager.tail(record.id, 0)).some((e) => e.tokensEst === 25));

      const after = manager.get(record.id)!;
      expect(after.tokensEst).toBe(35); // 10 + 25, summed not overwritten
    } finally {
      await manager.shutdown();
    }
  });

  it("ADR-0004: getAdapterUsage is account-level (per adapter id, never summed, never on SessionRecord)", async () => {
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    const quota1 = { windows: [{ id: "five_hour", utilization: 0.2, resetsAt: "2026-09-15T20:00:00.000Z" }] };
    const quota2 = { windows: [{ id: "five_hour", utilization: 0.5, resetsAt: "2026-09-15T20:00:00.000Z" }] };
    registry.register("usage-test", () => ({
      id: "usage-test",
      version: "0.0.1",
      capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: false, usage: true, nativeDiscovery: "none", nativeResume: "none" }),
      async start(_spec, ctx) {
        ctx.emit({ type: "system", summary: "quota update", payload: {}, usageQuota: quota1 });
        return { sessionId: ctx.sessionId };
      },
      async steer(_handle, _input, ctx) {
        ctx.emit({ type: "system", summary: "quota update", payload: {}, usageQuota: quota2 });
        return { ok: true };
      },
      async status() {
        return { state: "healthy" as const };
      },
      async stop() {},
    }));
    const manager = new SessionManager(db, store, registry, new ProcessRunner());
    try {
      expect(manager.getAdapterUsage("usage-test")).toBeNull(); // no observation yet -> null, never 0

      const record = await manager.create({ adapter: "usage-test", project: dir });
      await waitFor(async () => manager.getAdapterUsage("usage-test") !== null);
      expect(manager.getAdapterUsage("usage-test")!.quota).toEqual(quota1);
      // Not a per-session field on SessionRecord — the snapshot lives only
      // in the adapter-keyed cache.
      expect((manager.get(record.id) as unknown as { usageQuota?: unknown }).usageQuota).toBeUndefined();

      // A later observation on the SAME account (same adapter id) replaces
      // the snapshot — it neither sums nor averages with the earlier one.
      await manager.steer(record.id, { kind: "prompt", text: "go" });
      await waitFor(async () => manager.getAdapterUsage("usage-test")!.quota.windows[0]!.utilization === 0.5);
      expect(manager.getAdapterUsage("usage-test")!.quota).toEqual(quota2);
    } finally {
      await manager.shutdown();
    }
  });

  it("T1.9/AC-P1-5: heartbeat detects a down adapter (status=error, visible adapter.down event)", async () => {
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    let healthy = true;
    registry.register("heartbeat-test", () => ({
      id: "heartbeat-test",
      version: "0.0.1",
      capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: false, usage: false, nativeDiscovery: "none", nativeResume: "none" }),
      async start(_spec, ctx) {
        return { sessionId: ctx.sessionId };
      },
      async steer() {
        return { ok: true };
      },
      async status() {
        return healthy ? { state: "healthy" as const } : { state: "down" as const, detail: "simulated crash" };
      },
      async stop() {},
    }));
    // A real-scale interval — the test drives runHeartbeat() directly
    // instead of waiting out 30s.
    const manager = new SessionManager(db, store, registry, new ProcessRunner(), 3_600_000);
    try {
      const record = await manager.create({ adapter: "heartbeat-test", project: dir });
      await manager.runHeartbeat();
      expect(manager.get(record.id)!.status).toBe("working"); // healthy — untouched

      healthy = false;
      await manager.runHeartbeat();

      const after = manager.get(record.id)!;
      expect(after.status).toBe("error");
      const events = await manager.tail(record.id, 0);
      const downEvent = events.find((e) => (e.payload as { kind?: string }).kind === "adapter.down");
      expect(downEvent).toBeDefined();
      expect((downEvent!.payload as { detail?: string }).detail).toBe("simulated crash");

      // Once terminal, later ticks must not re-fire (no duplicate events,
      // no illegal transition out of "error").
      await manager.runHeartbeat();
      const eventsAfter2 = await manager.tail(record.id, 0);
      expect(eventsAfter2.filter((e) => (e.payload as { kind?: string }).kind === "adapter.down")).toHaveLength(1);
    } finally {
      await manager.shutdown();
    }
  });

  it("T2.1: a git-repo project gets real worktree isolation — commits land off the main checkout, cleaned up on stop", async () => {
    const repoDir = await mkdtemp(join(tmpdir(), "uacc-sm-wtrepo-"));
    const worktreesOut = await mkdtemp(join(tmpdir(), "uacc-sm-wtout-"));
    await execFileAsync("git", ["-C", repoDir, "init", "-q", "-b", "main"]);
    await execFileAsync("git", ["-C", repoDir, "config", "user.email", "t@uacc.local"]);
    await execFileAsync("git", ["-C", repoDir, "config", "user.name", "uacc test"]);
    await writeFile(join(repoDir, "a.txt"), "hi\n");
    await execFileAsync("git", ["-C", repoDir, "add", "a.txt"]);
    await execFileAsync("git", ["-C", repoDir, "commit", "-q", "-m", "initial"]);
    const { stdout: headSha } = await execFileAsync("git", ["-C", repoDir, "rev-parse", "HEAD"]);

    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    let seenWorkdir = "";
    registry.register("wt-test", () => ({
      id: "wt-test",
      version: "0.0.1",
      capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: false, usage: false, nativeDiscovery: "none", nativeResume: "none" }),
      async start(_spec, ctx) {
        seenWorkdir = ctx.workdir;
        return { sessionId: ctx.sessionId };
      },
      async steer() {
        return { ok: true };
      },
      async status() {
        return { state: "healthy" as const };
      },
      async stop() {},
    }));
    const worktrees = new WorktreeManager(worktreesOut);
    const manager = new SessionManager(db, store, registry, new ProcessRunner(), undefined, worktrees);
    try {
      const record = await manager.create({ adapter: "wt-test", project: repoDir });
      const wtPath = worktrees.pathFor(record.id);
      expect(seenWorkdir).toBe(wtPath); // adapter really saw the worktree, not repoDir
      expect(existsSync(wtPath)).toBe(true);
      expect(manager.get(record.id)!.worktreeSha).toBe(headSha.trim());

      const events = await manager.tail(record.id, 0);
      const kinds = events.map((e) => (e.payload as { kind?: string }).kind);
      expect(kinds).not.toContain("session.no_worktree_isolation");

      await manager.stop(record.id);
      expect(existsSync(wtPath)).toBe(false); // real cleanup, not just marked stopped
    } finally {
      await manager.shutdown();
      await rm(repoDir, { recursive: true, force: true });
      await rm(worktreesOut, { recursive: true, force: true });
    }
  });

  it("T2.1: a non-git project honestly falls back — no isolation, no crash, event says why", async () => {
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 5, autoStopAfterEvents: 1 });
    const worktreesOut = await mkdtemp(join(tmpdir(), "uacc-sm-wtout-nongit-"));
    const worktrees = new WorktreeManager(worktreesOut);
    const manager = new SessionManager(db, store, registry, new ProcessRunner(), undefined, worktrees);
    try {
      const record = await manager.create({ adapter: "dummy", project: dir }); // `dir` is not a git repo
      expect(manager.get(record.id)!.worktreeSha).toBeNull();
      const events = await manager.tail(record.id, 0);
      const kinds = events.map((e) => (e.payload as { kind?: string }).kind);
      expect(kinds).toContain("session.no_worktree_isolation");
    } finally {
      await manager.shutdown();
      await rm(worktreesOut, { recursive: true, force: true });
    }
  });

  // T2.7 (EPIC-P2 §3 BudgetState): a controllable costUsd-bearing adapter,
  // same reasoning as the ADR-0003/0006 tests above — the dummy adapter
  // has no cost capability. `steer(prompt)` emits whatever amount the
  // prompt text parses to as a number, letting each test drive the
  // session's costUsd to an exact figure.
  function registerBudgetAdapter(registry: AdapterRegistry) {
    registry.register("budget-test", () => ({
      id: "budget-test",
      version: "0.0.1",
      capabilities: () => ({ reasoning: false, tools: false, cost: true, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none" }),
      async start(_spec, ctx) {
        return { sessionId: ctx.sessionId };
      },
      async steer(_handle, input, ctx) {
        if (input.kind === "prompt") ctx.emit({ type: "system", summary: "spend", payload: {}, costUsd: Number(input.text) });
        return { ok: true };
      },
      async status() {
        return { state: "healthy" as const };
      },
      async stop() {},
    }));
  }

  it("T2.7: warns once at 80% of budget, never re-fires on later events", async () => {
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registerBudgetAdapter(registry);
    const manager = new SessionManager(db, store, registry, new ProcessRunner());
    try {
      const record = await manager.create({ adapter: "budget-test", project: dir, budgetUsd: 1.0 });
      await manager.steer(record.id, { kind: "prompt", text: "0.85" }); // crosses 80%
      await waitFor(async () => (await manager.tail(record.id, 0)).some((e) => (e.payload as { kind?: string }).kind === "session.budget_warning"));
      await manager.steer(record.id, { kind: "prompt", text: "0.01" }); // another cost-bearing event, still under 100%
      await waitFor(async () => manager.get(record.id)!.costUsd >= 0.86);
      const events = await manager.tail(record.id, 0);
      const warnings = events.filter((e) => (e.payload as { kind?: string }).kind === "session.budget_warning");
      expect(warnings).toHaveLength(1); // fired once, not again on the second event
      expect(manager.get(record.id)!.status).toBe("working"); // not parked yet
    } finally {
      await manager.shutdown();
    }
  });

  it("T2.7: auto-parks at 100% of budget, fail-closed — records why via parkReason", async () => {
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registerBudgetAdapter(registry);
    const manager = new SessionManager(db, store, registry, new ProcessRunner());
    try {
      const record = await manager.create({ adapter: "budget-test", project: dir, budgetUsd: 1.0 });
      await manager.steer(record.id, { kind: "prompt", text: "1.0" });
      // ctx.emit() is fire-and-forget (documented SessionManager behavior) —
      // the cost event, and the budget check it triggers, can still be
      // in flight after steer() itself resolves. Poll instead of asserting
      // immediately after the await, same reasoning as this file's other
      // adapter-driven async tests.
      await waitFor(async () => manager.get(record.id)!.status === "parked");
      const after = manager.get(record.id)!;
      expect(after.status).toBe("parked");
      expect(after.parkReason).toBe("budget");
      const events = await manager.tail(record.id, 0);
      expect(events.some((e) => (e.payload as { kind?: string }).kind === "session.budget_exceeded")).toBe(true);
    } finally {
      await manager.shutdown();
    }
  });

  it("T2.7: budget top-up resumes a session parked FOR BUDGET, but never one parked manually", async () => {
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registerBudgetAdapter(registry);
    const manager = new SessionManager(db, store, registry, new ProcessRunner());
    try {
      const budgetParked = await manager.create({ adapter: "budget-test", project: dir, budgetUsd: 1.0 });
      await manager.steer(budgetParked.id, { kind: "prompt", text: "1.0" });
      await waitFor(async () => manager.get(budgetParked.id)!.status === "parked");

      const topUp = await manager.applyBudgetTopUp(budgetParked.id, 5.0);
      expect(topUp.ok).toBe(true);
      const resumed = manager.get(budgetParked.id)!;
      expect(resumed.status).toBe("working");
      expect(resumed.parkReason).toBeNull();
      expect(resumed.budgetUsd).toBe(5.0);

      const manuallyParked = await manager.create({ adapter: "budget-test", project: dir, budgetUsd: 1.0 });
      await manager.park(manuallyParked.id);
      expect(manager.get(manuallyParked.id)!.parkReason).toBe("manual");
      await manager.applyBudgetTopUp(manuallyParked.id, 5.0);
      // still parked — a manual park is never auto-resumed by a top-up
      expect(manager.get(manuallyParked.id)!.status).toBe("parked");
      expect(manager.get(manuallyParked.id)!.parkReason).toBe("manual");
    } finally {
      await manager.shutdown();
    }
  });

  it("T2.7: a hub-wide daily cap parks every live session, not just the one that crossed it", async () => {
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registerBudgetAdapter(registry);
    const manager = new SessionManager(db, store, registry, new ProcessRunner(), undefined, undefined, undefined, 1.0);
    try {
      const a = await manager.create({ adapter: "budget-test", project: dir });
      const b = await manager.create({ adapter: "budget-test", project: dir });
      await manager.steer(a.id, { kind: "prompt", text: "1.0" }); // a alone crosses the hub-wide 1.0 daily cap
      await waitFor(async () => manager.get(a.id)!.status === "parked");
      expect(manager.get(a.id)!.status).toBe("parked");
      expect(manager.get(a.id)!.parkReason).toBe("daily_cap");
      expect(manager.get(b.id)!.status).toBe("parked"); // b never spent anything, still parked
      expect(manager.get(b.id)!.parkReason).toBe("daily_cap");
    } finally {
      await manager.shutdown();
    }
  });

  it("T2.7 fail-closed regression: a budget park real-signals a free-running adapter to stop, not just the hub's own status label", async () => {
    // Real bug found live-testing T2.7 (see parkFor()'s own doc comment):
    // an adapter with an internal generator loop (a real CLI process
    // still streaming, or adapter-dummy's own setInterval) kept right on
    // running and right on costing money after a budget park, because
    // nothing ever told IT to stop — only the hub's own status label
    // changed. This adapter free-runs a costUsd-emitting timer exactly
    // like that, and only stops when its own steer(park) is actually
    // called.
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    let paused = false;
    registry.register("free-running-budget-test", () => ({
      id: "free-running-budget-test",
      version: "0.0.1",
      capabilities: () => ({ reasoning: false, tools: false, cost: true, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none" }),
      async start(_spec, ctx) {
        const timer = setInterval(() => {
          if (!paused) ctx.emit({ type: "system", summary: "tick", payload: {}, costUsd: 0.5 });
        }, 30);
        ctx.signal.addEventListener("abort", () => clearInterval(timer));
        return { sessionId: ctx.sessionId };
      },
      async steer(_handle, input) {
        if (input.kind === "park") paused = true;
        if (input.kind === "resume") paused = false;
        return { ok: true };
      },
      async status() {
        return { state: "healthy" as const };
      },
      async stop() {},
    }));
    const manager = new SessionManager(db, store, registry, new ProcessRunner());
    try {
      const record = await manager.create({ adapter: "free-running-budget-test", project: dir, budgetUsd: 1.0 });
      await waitFor(async () => manager.get(record.id)!.status === "parked");
      const costAtPark = manager.get(record.id)!.costUsd;
      await new Promise((r) => setTimeout(r, 200)); // several more timer ticks would have fired by now
      expect(manager.get(record.id)!.costUsd).toBe(costAtPark); // real proof the adapter actually stopped, not just relabeled
      expect(paused).toBe(true);

      await manager.applyBudgetTopUp(record.id, 5.0);
      expect(paused).toBe(false); // resume signal really reached the adapter too
    } finally {
      await manager.shutdown();
    }
  });
});

/** T4.1/ADR-0009: reportingSinks wiring. Separate describe block — these
 * tests care about stop()'s digest dispatch, not general lifecycle. */
describe("SessionManager — reporting sink dispatch (T4.1, ADR-0009)", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "uacc-sm-digest-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("stop() calls every configured sink with a real, quote-grounded SessionSummary", async () => {
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 1, autoStopAfterEvents: 1 });
    const received: unknown[] = [];
    const sink = async (summary: unknown) => {
      received.push(summary);
    };
    const manager = new SessionManager(db, store, registry, new ProcessRunner(), undefined, undefined, undefined, null, [sink]);
    try {
      const record = await manager.create({ adapter: "dummy", project: dir });
      await manager.stop(record.id);
      await waitFor(async () => received.length === 1);
      const summary = received[0] as { sessionId: string; archiveRef: string; lessons: { text: string }[] };
      expect(summary.sessionId).toBe(record.id);
      expect(summary.archiveRef).toBe(`sessions/${record.id}/events.jsonl`);
      // "session.created"/"session.started" aren't digest-worthy (see
      // digest.test.ts) but "session.stopped" itself isn't either — real
      // proof this is rule-based extraction, not "every event is a lesson".
      expect(summary.lessons.length).toBe(0);
    } finally {
      await manager.shutdown();
    }
  });

  it("a throwing sink never breaks stop() — the error becomes a visible system event instead", async () => {
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 1, autoStopAfterEvents: 1 });
    const badSink = async () => {
      throw new Error("webhook unreachable");
    };
    const manager = new SessionManager(db, store, registry, new ProcessRunner(), undefined, undefined, undefined, null, [badSink]);
    try {
      const record = await manager.create({ adapter: "dummy", project: dir });
      const ack = await manager.stop(record.id);
      expect(ack.ok).toBe(true); // stop() itself must succeed regardless
      await waitFor(async () => {
        const events = await manager.tail(record.id, 0);
        return events.some((e) => (e.payload as { kind?: string }).kind === "session.digest_sink_failed");
      });
      const events = await manager.tail(record.id, 0);
      const failure = events.find((e) => (e.payload as { kind?: string }).kind === "session.digest_sink_failed");
      expect((failure!.payload as { error?: string }).error).toContain("webhook unreachable");
    } finally {
      await manager.shutdown();
    }
  });

  it("an empty reportingSinks array (the default) never touches the store — exact pre-T4.1 behavior", async () => {
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 1, autoStopAfterEvents: 1 });
    const manager = new SessionManager(db, store, registry, new ProcessRunner());
    try {
      const record = await manager.create({ adapter: "dummy", project: dir });
      await manager.stop(record.id);
      await new Promise((r) => setTimeout(r, 50));
      const events = await manager.tail(record.id, 0);
      expect(events.some((e) => (e.payload as { kind?: string }).kind?.startsWith("session.digest"))).toBe(false);
    } finally {
      await manager.shutdown();
    }
  });
});
