import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { basicFeatures, type Adapter, type AdapterContext } from "@uacc/contracts";
import { TmuxRunner } from "@uacc/workers";
import { AdapterRegistry } from "../../../src/modules/harness/registry.ts";
import { EventStore } from "../../../src/platform/eventstore.ts";
import { HubDatabase } from "../../../src/platform/db.ts";
import { SessionManager } from "../../../src/modules/sessions/session-manager.ts";

/** EPIC-P17 AC-P17-1: after a hub kill + restart, 100 % of the surviving
 * tmux workers are mapped back to their session via the @uacc_session
 * marker (ADR-0037) — with TWO different adapters, inside K7's 3 s budget.
 * Skips visibly without tmux (ADR-0002 pattern). */
const hasTmux = (await new TmuxRunner(join(tmpdir(), "probe")).isAvailable()).valueOf();
const itTmux = hasTmux ? it : it.skip;

/** ADR-0014/0037 pattern: start spawns a real worker, recover takes it back
 * via ctx.adoptWorker() — which resolves through the marker, not the name. */
function sleepingAdapter(id: string): Adapter {
  return {
    id,
    version: "0.0.1",
    capabilities: () => ({
      reasoning: false,
      tools: false,
      cost: false,
      steer: true,
      usage: false,
      nativeDiscovery: "none",
      nativeResume: "none",
      features: basicFeatures(),
    }),
    async start(_spec, ctx: AdapterContext) {
      await ctx.spawnWorker(["bash", "-c", "sleep 60"], { persistent: true });
      return { sessionId: ctx.sessionId };
    },
    async recover(sessionId: string, _lastSeq: number, ctx: AdapterContext) {
      const proc = (await ctx.adoptWorker?.({ persistent: true })) ?? null;
      return proc ? { sessionId, ...(proc.pid !== undefined ? { pid: proc.pid } : {}) } : null;
    },
    async steer() {
      return { ok: true };
    },
    async status() {
      return { state: "healthy" as const };
    },
    async stop() {
      /* the runner's reap handles the process */
    },
  };
}

describe("AC-P17-1: Marker-Zuordnung nach Hub-Restart", () => {
  itTmux("100 % der laufenden Worker werden über @uacc_session zugeordnet (2 Adapter × 2, K7 < 3 s)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uacc-recmarker-"));
    const logs = join(dir, "workers");
    const registry = new AdapterRegistry();
    registry.register("sleepa", () => sleepingAdapter("sleepa"));
    registry.register("sleepb", () => sleepingAdapter("sleepb"));
    const first = new SessionManager(new HubDatabase(join(dir, "hub.db")), new EventStore(dir), registry, new TmuxRunner(logs));
    const ids: string[] = [];
    for (const adapter of ["sleepa", "sleepb", "sleepa", "sleepb"]) {
      ids.push((await first.create({ adapter, project: dir, prompt: "x" })).id);
    }
    await first.shutdown({ keepWorkers: true }); // hub gone, tmux workers alive

    const runner = new TmuxRunner(logs);
    const second = new SessionManager(new HubDatabase(join(dir, "hub.db")), new EventStore(dir), registry, runner);
    try {
      const t0 = performance.now();
      const result = await second.recoverAll();
      const elapsed = performance.now() - t0;
      expect(result.recovered).toBe(4);
      expect(elapsed).toBeLessThan(3000); // the K7 budget, same as session-manager.test.ts
      const workers = await runner.list();
      expect(workers).toHaveLength(4);
      for (const id of ids) {
        expect(workers.some((w) => w.sessionId === id)).toBe(true); // 100 % marker-mapped
      }
    } finally {
      await second.shutdown();
      await runner.reapOrphans([]); // no tmux sessions leaking into the user's default server
      await rm(dir, { recursive: true, force: true });
    }
  }, 20_000);
});
