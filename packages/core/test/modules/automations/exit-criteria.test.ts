import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AutomationDefinition, AutomationSchedule, AutomationSkipReason } from "@ancientvoid/contracts";
import {
  AutomationService, AutomationStore, AutomationsScheduler, nextOccurrences,
  type AutomationLauncher, type AutomationPrechecker, type PrecheckResult,
} from "../../../src/modules/automations/index.ts";

/**
 * EPIC-P41 Exit-Lücken (AC-P41-2/3/4): reine Unit-Belege ohne Live-Infrastruktur.
 * Sie ersetzen weder echte Provider-/Quota-/Lease-Proben noch einen Prozess-Crash.
 */

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(r => rm(r, { recursive: true, force: true }))); });
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "av-p41-exit-"));
  roots.push(root);
  return root;
}

const PROMPT = "Exit-Kriterien prüfen";
const PROMPT_SHA = createHash("sha256").update(PROMPT).digest("hex");

function definition(over: Partial<AutomationDefinition> = {}): AutomationDefinition {
  return {
    id: "exit", label: "Exit", generation: 1, enabled: true, hostId: "host",
    schedule: { kind: "cron", cron: "30 2 * * *", timezone: "Europe/Berlin" },
    target: { kind: "session", harness: "dummy", workdir: "worktree", project: "/tmp", promptBlobSha256: PROMPT_SHA },
    grant: { maxParallel: 1, missedGraceMs: 0 }, precheckDeadlineMs: 60_000, createdAtUtc: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("AC-P41-2: gefeuerte Termine entsprechen der Vorschau (DST, Zeitzonen)", () => {
  /** Minutentakt durch das Fenster; jeder Tick hat die Uhr exakt auf einer Minutengrenze. */
  async function fired(schedule: AutomationSchedule, fromIso: string, toIso: string): Promise<string[]> {
    const root = await tempRoot();
    const store = new AutomationStore(root);
    const clock = { now: Date.parse(fromIso) };
    store.upsertDefinition(definition({ schedule, createdAtUtc: fromIso }), fromIso);
    const scheduler = new AutomationsScheduler({
      store, hostId: "host", now: () => clock.now,
      async precheck() { return "ok"; },
      async dispatch() { return { ok: true, sessionId: "s" }; },
      async inspect() { return { state: "settled", outcome: "succeeded" }; },
    });
    for (; clock.now <= Date.parse(toIso); clock.now += 60_000) await scheduler.tick();
    return store.claimsFor("exit").filter(c => c.state === "dispatched" || c.state === "settled").map(c => c.occurrenceUtc).sort();
  }

  const cases: { name: string; schedule: AutomationSchedule; from: string; to: string; expected: string[] }[] = [
    { name: "Berlin Frühjahr: 02:30 existiert am 29.03.2026 nicht und entfällt",
      schedule: { kind: "cron", cron: "30 2 * * *", timezone: "Europe/Berlin" }, from: "2026-03-28T00:00:00.000Z", to: "2026-03-30T06:00:00.000Z",
      expected: ["2026-03-28T01:30:00.000Z", "2026-03-30T00:30:00.000Z"] },
    { name: "Berlin Herbst: 02:30 tritt zweimal auf und feuert einmal (früherer Moment)",
      schedule: { kind: "cron", cron: "30 2 * * *", timezone: "Europe/Berlin" }, from: "2026-10-24T00:00:00.000Z", to: "2026-10-26T06:00:00.000Z",
      expected: ["2026-10-24T00:30:00.000Z", "2026-10-25T00:30:00.000Z", "2026-10-26T01:30:00.000Z"] },
    { name: "New York Frühjahr (Preset täglich 02:30) entfällt am 08.03.2026",
      schedule: { kind: "preset", preset: "daily", localTime: "02:30", timezone: "America/New_York" }, from: "2026-03-07T00:00:00.000Z", to: "2026-03-09T12:00:00.000Z",
      expected: ["2026-03-07T07:30:00.000Z", "2026-03-09T06:30:00.000Z"] },
    { name: "New York Herbst: 01:30 doppelt, einmal am 01.11.2026",
      schedule: { kind: "cron", cron: "30 1 * * *", timezone: "America/New_York" }, from: "2026-10-31T00:00:00.000Z", to: "2026-11-02T12:00:00.000Z",
      expected: ["2026-10-31T05:30:00.000Z", "2026-11-01T05:30:00.000Z", "2026-11-02T06:30:00.000Z"] },
  ];

  for (const c of cases) {
    it(c.name, async () => {
      const preview = nextOccurrences(c.schedule, c.from, 10).map(o => o.utc).filter(utc => utc <= c.to);
      expect(preview).toEqual(c.expected); // dokumentierte Vorschau
      expect(await fired(c.schedule, c.from, c.to)).toEqual(preview); // tatsächliches Feuern
    }, 60_000);
  }

  it("Zeitzonenwechsel ist eine wesentliche Änderung: neue Generation, deaktiviert, Vorschau in neuer Zone", async () => {
    const root = await tempRoot();
    const launcher: AutomationLauncher = { async launch() { return { ok: true, sessionId: "s" }; } };
    const prechecker: AutomationPrechecker = { async run() { return "ok"; } };
    const clock = { now: Date.parse("2026-06-01T10:00:00.000Z") };
    const service = new AutomationService({ root, hostId: "host", launcher, prechecker, now: () => clock.now });
    const created = service.create(definition({ createdAtUtc: "2026-06-01T09:00:00.000Z" }), PROMPT);
    service.setEnabled(created.id, true, 1);
    const before = service.list()[0]!.nextOccurrences[0]!;
    expect(before.local).toBe("2026-06-02T02:30+02:00");
    const moved = service.update(created.id, { ...created, schedule: { kind: "cron", cron: "30 2 * * *", timezone: "America/New_York" } })!;
    expect(moved.generation).toBe(2);
    expect(moved.enabled).toBe(false);
    const after = service.list()[0]!.nextOccurrences[0]!;
    expect(after.local).toBe("2026-06-02T02:30-04:00");
    expect(after.utc).not.toBe(before.utc);
    clock.now = Date.parse(after.utc) + 1_000;
    await service.tick();
    expect(service.history(created.id)).toEqual([]); // deaktiviert: die alte Freigabe feuert nicht in der neuen Zone
  });
});

describe("AC-P41-3: Crash zwischen Claim und Dispatch (Dienst-Neustart)", () => {
  it("startet den beanspruchten Termin nicht erneut und zeigt ihn als unknown", async () => {
    const root = await tempRoot();
    const occurrence = "2026-06-02T00:30:00.000Z";
    const clock = { now: Date.parse(occurrence) + 5_000 };
    let launches = 0;
    const launcher: AutomationLauncher = { async launch() { launches++; return { ok: true, sessionId: "s" }; } };
    const prechecker: AutomationPrechecker = { async run() { return "ok"; } };
    const first = new AutomationService({ root, hostId: "host", launcher, prechecker, now: () => clock.now });
    const created = first.create(definition({ createdAtUtc: "2026-06-01T09:00:00.000Z" }), PROMPT);
    first.setEnabled(created.id, true, 1);
    first.stop();
    // Simulierter Absturz: Claim ist dauerhaft, der Dispatch hat nie stattgefunden bzw. keine Quittung geschrieben.
    expect(new AutomationStore(root).claim(created.id, 1, occurrence, new Date(clock.now).toISOString(), { kind: "due" })).not.toBeNull();

    const restarted = new AutomationService({ root, hostId: "host", launcher, prechecker, now: () => clock.now });
    const [claim] = restarted.history(created.id);
    expect(claim).toMatchObject({ occurrenceUtc: occurrence, state: "unknown" });
    expect(claim!.detail).toMatch(/kein Replay/);
    await restarted.tick(); await restarted.tick();
    expect(launches).toBe(0);
    expect(restarted.list()[0]!.lastOccurrence).toMatchObject({ utc: occurrence, state: "unknown" });
    // Auch ein weiterer Neustart stellt keinen Replay her (Journal ist die Quelle, K7).
    const again = new AutomationService({ root, hostId: "host", launcher, prechecker, now: () => clock.now });
    await again.tick();
    expect(launches).toBe(0);
    expect(again.history(created.id).filter(c => c.occurrenceUtc === occurrence)).toHaveLength(1);
  });
});

describe("AC-P41-4: Precheck-/Dispatch-Gründe bleiben getrennt", () => {
  const verdicts: Exclude<PrecheckResult, "ok" | null>[] = ["precheck", "precheck_exit", "precheck_timeout", "auth", "quota", "lease", "host_down"];

  async function runWith(opts: { precheck?: () => Promise<PrecheckResult>; dispatch?: () => Promise<{ ok: false; reason: AutomationSkipReason; uncertain?: boolean }> }) {
    const root = await tempRoot();
    const store = new AutomationStore(root);
    const clock = { now: Date.parse("2026-06-02T00:30:30.000Z") };
    store.upsertDefinition(definition({ precheckActionId: "check", createdAtUtc: "2026-06-01T09:00:00.000Z" }), new Date(clock.now).toISOString());
    let dispatches = 0;
    const scheduler = new AutomationsScheduler({
      store, hostId: "host", now: () => clock.now,
      precheck: opts.precheck ?? (async () => "ok"),
      async dispatch() { dispatches++; return opts.dispatch ? opts.dispatch() : { ok: true }; },
    });
    await scheduler.tick();
    return { claim: store.claimsFor("exit")[0]!, dispatches };
  }

  for (const verdict of verdicts) {
    it(`Precheck-Urteil ${verdict} wird genau dieser Skip-Grund und startet nichts`, async () => {
      const { claim, dispatches } = await runWith({ precheck: async () => verdict });
      expect(claim).toMatchObject({ state: "skipped", reason: verdict });
      expect(dispatches).toBe(0);
    });
  }

  it("ein Precheck, der wirft, ist `precheck` mit Detail — kein Dispatch, kein stilles Verschlucken", async () => {
    const { claim, dispatches } = await runWith({ precheck: async () => { throw new Error("argv nicht startbar"); } });
    expect(claim).toMatchObject({ state: "skipped", reason: "precheck", detail: expect.stringContaining("argv nicht startbar") });
    expect(dispatches).toBe(0);
  });

  for (const reason of ["auth", "quota", "lease", "host_down", "precheck"] as const) {
    it(`Dispatch-Ablehnung ${reason} bleibt ${reason}`, async () => {
      const { claim } = await runWith({ dispatch: async () => ({ ok: false, reason }) });
      expect(claim).toMatchObject({ state: "skipped", reason });
    });
  }

  it("ein unsicherer Dispatch wird unknown statt Skip (kein Replay-Anlass)", async () => {
    const { claim } = await runWith({ dispatch: async () => ({ ok: false, reason: "host_down", uncertain: true }) });
    expect(claim.state).toBe("unknown");
  });
});

describe("ADR-0072: einen unklaren Start ohne Referenz aufgeben", () => {
  async function crashed() {
    const root = await tempRoot();
    const occurrence = "2026-06-02T00:30:00.000Z";
    const clock = { now: Date.parse(occurrence) + 5_000 };
    let launches = 0;
    const launcher: AutomationLauncher = { async launch() { launches++; return { ok: true, sessionId: "s" }; } };
    const prechecker: AutomationPrechecker = { async run() { return "ok"; } };
    const make = () => new AutomationService({ root, hostId: "host", launcher, prechecker, now: () => clock.now });
    const first = make();
    const created = first.create(definition({ createdAtUtc: "2026-06-01T09:00:00.000Z" }), PROMPT);
    first.setEnabled(created.id, true, 1);
    first.stop();
    const claimKey = new AutomationStore(root).claim(created.id, 1, occurrence, new Date(clock.now).toISOString(), { kind: "due" })!.claimKey;
    return { make, service: make(), id: created.id, claimKey, clock, launches: () => launches };
  }

  it("gibt das Budget frei: abgerechnet als aufgegeben, mit Notiz, der nächste Termin startet", async () => {
    const { service, id, claimKey, clock, launches } = await crashed();
    clock.now = Date.parse("2026-06-03T00:30:05.000Z");
    await service.tick();
    expect(launches()).toBe(0);
    expect(service.history(id)[0]).toMatchObject({ state: "skipped", reason: "overlap" });

    const resolved = service.resolveUnknown(id, claimKey, "Hub abgestürzt, nichts gestartet")!;
    expect(resolved).toMatchObject({ state: "settled", outcome: "abandoned", detail: "manuell aufgegeben: Hub abgestürzt, nichts gestartet" });
    expect(resolved.sessionId).toBeUndefined();
    clock.now = Date.parse("2026-06-04T00:30:05.000Z");
    await service.tick();
    expect(launches()).toBe(1);
  });

  it("bleibt nach einem Neustart aufgegeben (Journal, K7) und wird nicht neu gestartet", async () => {
    const { make, service, id, claimKey, launches } = await crashed();
    service.resolveUnknown(id, claimKey, "geprüft");
    service.stop();
    const restarted = make();
    expect(restarted.history(id).find(c => c.claimKey === claimKey)).toMatchObject({ state: "settled", outcome: "abandoned" });
    await restarted.tick();
    expect(launches()).toBe(0);
  });

  it("lehnt ab, was kein unklarer Start ohne Referenz ist", async () => {
    const { service, id, claimKey } = await crashed();
    expect(service.resolveUnknown(id, "gibt-es-nicht", "x")).toBeNull();
    expect(service.resolveUnknown("andere-automation", claimKey, "x")).toBeNull();
    service.resolveUnknown(id, claimKey, "einmal");
    expect(() => service.resolveUnknown(id, claimKey, "zweimal")).toThrow(/Zustand: settled/);
  });

  it("ein unklarer Start mit Referenz bleibt beim Abgleich", async () => {
    const root = await tempRoot();
    const store = new AutomationStore(root);
    store.upsertDefinition(definition(), "2026-06-01T09:00:00.000Z");
    const claim = store.claim("exit", 1, "2026-06-02T00:30:00.000Z", "2026-06-02T00:30:01.000Z")!;
    store.updateClaim(claim.claimKey, { state: "unknown", sessionId: "s-1", detail: "Referenzierte Session nicht verfügbar" }, "2026-06-02T00:31:00.000Z");
    const service = new AutomationService({ root, hostId: "host", launcher: { async launch() { return { ok: true }; } }, prechecker: { async run() { return "ok"; } } });
    expect(() => service.resolveUnknown("exit", claim.claimKey, "x")).toThrow(/Referenz/);
  });
});
