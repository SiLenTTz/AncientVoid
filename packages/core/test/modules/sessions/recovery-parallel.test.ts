import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { basicFeatures, type Adapter } from "@uacc/contracts";
import { ProcessRunner } from "@uacc/workers";
import { AdapterRegistry } from "../../../src/modules/harness/registry.ts";
import { EventStore } from "../../../src/platform/eventstore.ts";
import { HubDatabase } from "../../../src/platform/db.ts";
import { SessionManager } from "../../../src/modules/sessions/session-manager.ts";

/** BUG-0050: die Recovery wartet nicht auf jede Session einzeln (K7: < 3 s). */
describe("recoverAll arbeitet parallel", () => {
  const DELAY = 150;
  const make = (inFlight: { now: number; max: number }, failing = false) => {
    const adapter: Adapter = {
      id: "slowrec",
      version: "0.0.1",
      capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures() }),
      async start(_s, ctx) {
        return { sessionId: ctx.sessionId };
      },
      async recover(sessionId, _lastSeq, ctx) {
        inFlight.now++;
        inFlight.max = Math.max(inFlight.max, inFlight.now);
        await new Promise((r) => setTimeout(r, DELAY));
        inFlight.now--;
        await ctx.adoptWorker?.();
        if (failing && sessionId.startsWith("0")) throw new Error("kaputt");
        return { sessionId };
      },
      async steer() {
        return { ok: true };
      },
      async status() {
        return { state: "healthy" };
      },
      async stop() {},
    };
    const registry = new AdapterRegistry();
    registry.register("slowrec", () => adapter);
    return registry;
  };

  it("zwölf Sessions brauchen nicht zwölf Wartezeiten, höchstens sechs laufen gleichzeitig", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uacc-recpar-"));
    const file = join(dir, "hub.db");
    const first = new SessionManager(new HubDatabase(file), new EventStore(dir), make({ now: 0, max: 0 }), new ProcessRunner());
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) ids.push((await first.create({ adapter: "slowrec", project: dir })).id);
    await first.shutdown({ keepWorkers: true });

    const inFlight = { now: 0, max: 0 };
    const second = new SessionManager(new HubDatabase(file), new EventStore(dir), make(inFlight), new ProcessRunner());
    try {
      const t0 = Date.now();
      const result = await second.recoverAll();
      const took = Date.now() - t0;
      expect(result.recovered + result.uncontrolled).toBe(12);
      expect(result.failed).toBe(0);
      expect(took).toBeLessThan(DELAY * 12 * 0.6); // sequenziell wären es ≥ 1800 ms
      expect(inFlight.max).toBeGreaterThan(1);
      expect(inFlight.max).toBeLessThanOrEqual(6);
      for (const id of ids) expect(second.get(id)).toBeDefined();
    } finally {
      await second.shutdown();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("ein fehlschlagender Adapter reißt die anderen nicht mit und wird gezählt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uacc-recpar-fail-"));
    const file = join(dir, "hub.db");
    const first = new SessionManager(new HubDatabase(file), new EventStore(dir), make({ now: 0, max: 0 }), new ProcessRunner());
    for (let i = 0; i < 8; i++) await first.create({ adapter: "slowrec", project: dir });
    await first.shutdown({ keepWorkers: true });
    const second = new SessionManager(new HubDatabase(file), new EventStore(dir), make({ now: 0, max: 0 }, true), new ProcessRunner());
    try {
      const result = await second.recoverAll();
      expect(result.failed + result.recovered + result.uncontrolled).toBe(8);
      expect(result.recovered + result.uncontrolled).toBeGreaterThan(0);
    } finally {
      await second.shutdown();
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("eine zu langsame Recovery nennt, welcher Adapter und welche Sessions die Zeit kosten", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uacc-recdetail-"));
    const file = join(dir, "hub.db");
    const first = new SessionManager(new HubDatabase(file), new EventStore(dir), make({ now: 0, max: 0 }), new ProcessRunner());
    for (let i = 0; i < 8; i++) await first.create({ adapter: "slowrec", project: dir });
    await first.shutdown({ keepWorkers: true });

    const lines: { level: string; msg: string; fields?: Record<string, unknown> }[] = [];
    const record = (level: string) => (msg: string, fields?: Record<string, unknown>) => void lines.push({ level, msg, ...(fields ? { fields } : {}) });
    const logger = { debug: record("debug"), info: record("info"), warn: record("warn"), error: record("error"), child: () => logger };
    const second = new SessionManager(new HubDatabase(file), new EventStore(dir), make({ now: 0, max: 0 }), new ProcessRunner(), undefined, undefined, undefined, null, [], { logger, recoveryBudgetMs: 50 });
    try {
      await second.recoverAll();
      expect(lines.some((l) => l.level === "warn" && l.msg === "recovery exceeded K7 budget")).toBe(true);
      const detail = lines.find((l) => l.msg === "recovery detail")?.fields as {
        perAdapter: Record<string, { sessions: number; totalMs: number; maxMs: number }>;
        slowest: { session: string; adapter: string; ms: number }[];
        sessionsMs: number;
        reapMs: number;
      };
      expect(detail.perAdapter.slowrec).toMatchObject({ sessions: 8 });
      expect(detail.perAdapter.slowrec!.maxMs).toBeGreaterThanOrEqual(DELAY - 20);
      expect(detail.slowest.length).toBe(5);
      expect(detail.slowest[0]!.adapter).toBe("slowrec");
      expect(detail.sessionsMs).toBeGreaterThan(0);
      expect(typeof detail.reapMs).toBe("number");
    } finally {
      await second.shutdown();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
