import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Adapter } from "@uacc/contracts";
import { basicFeatures } from "@uacc/contracts";
import { EventStore, HubDatabase, SessionManager, AdapterRegistry } from "../../../src/index.ts";
import { ProcessRunner } from "@uacc/workers";

const oneProcessPerTurn = (): Adapter => ({
  id: "turns",
  version: "0.0.1",
  capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures({ followUp: true, interrupt: true }) }),
  async start(_spec, ctx) {
    await ctx.spawnWorker(["sh", "-c", "sleep 0.2"]);
    return { sessionId: ctx.sessionId };
  },
  async steer(_handle, input, ctx) {
    if (input.kind === "prompt") await ctx.spawnWorker(["sh", "-c", "sleep 0.2"]);
    return { ok: true };
  },
  async status() {
    return { state: "healthy" };
  },
  async stop() {},
});

async function waitFor(check: () => boolean | Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 8000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("Zug-Messwerte im SessionManager (EPIC-P21 T21.3)", () => {
  it("jeder beendete Zug wird gemessen; nach Verlust der Tabelle baut der Backfill sie aus dem JSONL neu", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uacc-turnmetrics-"));
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("turns", oneProcessPerTurn);
    const manager = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    try {
      const record = await manager.create({ adapter: "turns", project: dir, prompt: "eins" });
      await waitFor(() => manager.turnMetrics(record.id).length === 1, "erster Zug gemessen");
      await manager.steer(record.id, { kind: "prompt", text: "zwei" });
      await waitFor(() => manager.turnMetrics(record.id).length === 2, "zweiter Zug gemessen");

      const [first] = manager.turnMetrics(record.id);
      expect(first).toMatchObject({ adapter: "turns", turn: 1, outcome: "ok" });
      expect(first!.durationMs).toBeGreaterThan(0);
      // weniger als 5 Züge: ehrlich keine Schätzung
      expect(manager.runEstimate(record.id)).toMatchObject({ state: "too-few", n: 2 });
      expect(manager.runEstimate("unbekannt")).toBeNull();

      // K7: Tabelle weg → Backfill aus dem Event-Strom, gleiche Werte.
      const before = manager.turnMetrics(record.id);
      db.prepare("DELETE FROM turn_metrics").run();
      expect(manager.turnMetrics(record.id)).toEqual([]);
      expect(await manager.backfillTurnMetrics()).toBe(1);
      expect(manager.turnMetrics(record.id)).toEqual(before);
    } finally {
      await manager.shutdown?.();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
