import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AutomationStore, AutomationsScheduler } from "../../../src/modules/automations/index.ts";
import type { AutomationDefinition } from "@ancientvoid/contracts";

const definition = (now: string): AutomationDefinition => ({
  id: "lifecycle", label: "Minutentakt", generation: 1, enabled: true, hostId: "host",
  schedule: { kind: "cron", cron: "* * * * *", timezone: "UTC" },
  target: { kind: "session", harness: "dummy", project: "/tmp", workdir: "worktree", promptBlobSha256: "a".repeat(64) },
  precheckDeadlineMs: 60_000, grant: { maxParallel: 1, missedGraceMs: 0 }, createdAtUtc: now,
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "av-p41-lifecycle-"));
  const store = new AutomationStore(root);
  const clock = { now: Date.parse("2026-11-10T10:00:30.000Z") };
  store.upsertDefinition(definition("2026-11-10T09:59:30.000Z"), new Date(clock.now).toISOString());
  return { root, store, clock, clean: () => rm(root, { recursive: true, force: true }) };
}

describe("P41 lifecycle and bounded recovery", () => {
  it("settles from execution evidence and releases overlap for the next occurrence", async () => {
    const h = await setup();
    let launches = 0;
    const scheduler = new AutomationsScheduler({ store: h.store, hostId: "host", now: () => h.clock.now,
      async precheck() { return "ok"; },
      async dispatch() { return { ok: true, sessionId: `session-${++launches}` }; },
      async inspect() { return { state: "settled", outcome: "succeeded" }; },
    });
    try {
      await scheduler.tick();
      h.clock.now += 60_000;
      await scheduler.tick();
      expect(launches).toBe(2);
      expect(h.store.claimsFor("lifecycle")[0]).toMatchObject({ state: "settled", outcome: "succeeded" });
    } finally { scheduler.stop(); await h.clean(); }
  });

  it("a crash around dispatch stays unknown and never restarts blindly", async () => {
    const h = await setup();
    const attempts: string[] = [];
    const scheduler = new AutomationsScheduler({ store: h.store, hostId: "host", now: () => h.clock.now,
      async precheck() { return "ok"; },
      async dispatch(_def, claimKey) { attempts.push(claimKey); throw new Error("Crash nach Eigentümer-Start, vor der Quittung"); },
    });
    try {
      await scheduler.tick();
      const claims = () => h.store.claimsFor("lifecycle").sort((a, b) => a.occurrenceUtc.localeCompare(b.occurrenceUtc));
      expect(claims()[0]!.state).toBe("unknown"); // ohne Referenz darf der unbelegte Start nie blind wiederholt werden
      h.clock.now += 60_000;
      await scheduler.tick();
      expect(attempts).toHaveLength(1);
      expect(claims()[1]?.reason).toBe("overlap"); // unknown hält das Überlappungsbudget bis zur belegten Auflösung
    } finally { scheduler.stop(); await h.clean(); }
  });

  for (const change of ["disable", "generation", "disable-enable"] as const) {
    it(`refuses dispatch when ${change} occurs during a precheck`, async () => {
      const h = await setup();
      const original = h.store.definition("lifecycle")!;
      h.store.upsertDefinition({ ...original, precheckActionId: "check" }, new Date(h.clock.now).toISOString());
      let release!: () => void;
      let entered!: () => void;
      const pending = new Promise<void>((resolve) => { release = resolve; });
      const started = new Promise<void>((resolve) => { entered = resolve; });
      let launches = 0;
      const scheduler = new AutomationsScheduler({ store: h.store, hostId: "host", now: () => h.clock.now,
        async precheck() { entered(); await pending; return "ok"; },
        async dispatch() { launches++; return { ok: true, sessionId: "unexpected" }; },
      });
      try {
        const tick = scheduler.tick();
        await started;
        const current = h.store.definition("lifecycle")!;
        h.store.upsertDefinition(change === "generation" ? { ...current, label: "new grant" } : { ...current, enabled: false }, new Date(h.clock.now).toISOString());
        if (change === "disable-enable") h.store.upsertDefinition({ ...h.store.definition("lifecycle")!, enabled: true }, new Date(h.clock.now).toISOString());
        release(); await tick;
        expect(launches).toBe(0);
        expect(h.store.claimsFor("lifecycle")[0]?.state).toBe("skipped");
      } finally { release(); scheduler.stop(); await h.clean(); }
    });
  }

  it("bounds a year of missed minutely occurrences and catches up only the latest", async () => {
    const h = await setup();
    h.store.upsertDefinition({ ...definition("2025-11-10T10:00:00.000Z"), grant: { maxParallel: 1, missedGraceMs: 120_000 } }, new Date(h.clock.now).toISOString());
    let launches = 0;
    const scheduler = new AutomationsScheduler({ store: h.store, hostId: "host", now: () => h.clock.now,
      async precheck() { return "ok"; }, async dispatch() { launches++; return { ok: true, sessionId: "latest" }; },
    });
    try {
      const start = performance.now();
      await scheduler.tick();
      expect(performance.now() - start).toBeLessThan(2000);
      expect(launches).toBe(1);
      expect(h.store.claimsFor("lifecycle").length).toBeLessThanOrEqual(2);
      expect(h.store.claimsFor("lifecycle").find(c => c.state === "skipped")?.missedThroughUtc).toBeTruthy();
      await scheduler.tick(); expect(launches).toBe(1);
    } finally { scheduler.stop(); await h.clean(); }
  });
});
