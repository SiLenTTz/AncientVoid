import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Adapter, SessionMetricsState } from "@ancientvoid/contracts";
import { basicFeatures } from "@ancientvoid/contracts";
import { EventStore, HubDatabase, SessionManager, AdapterRegistry } from "../../../src/index.ts";
import { rowToRecord, type SessionRow } from "../../../src/modules/sessions/session-row.ts";
import { ProcessRunner } from "@ancientvoid/workers";

/** One worker per turn; "KOSTEN" in the prompt reports a provider cost. */
function billedSometimes(): Adapter {
  const turn = async (ctx: Parameters<Adapter["start"]>[1], text: string) => {
    if (text.includes("KOSTEN")) ctx.emit({ type: "system", summary: "result", payload: {}, costUsd: 0.25 });
    await ctx.spawnWorker(["sh", "-c", "sleep 0.2"]);
  };
  return {
    id: "billed",
    version: "0.0.1",
    capabilities: () => ({ reasoning: false, tools: false, cost: true, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures({ followUp: true, interrupt: true }) }),
    async start(spec, ctx) {
      await turn(ctx, spec.prompt ?? "");
      return { sessionId: ctx.sessionId };
    },
    async steer(_h, input, ctx) {
      if (input.kind === "prompt") await turn(ctx, input.text);
      return { ok: true };
    },
    async status() {
      return { state: "healthy" };
    },
    async stop() {},
  };
}

async function waitFor(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("honest session metrics (T7.7, ADR-0023)", () => {
  it("a turn without a cost report makes the sum partial; tokens never reported stay unknown — persisted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-metrics-"));
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("billed", billedSometimes);
    const manager = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    try {
      const record = await manager.create({ adapter: "billed", project: dir, prompt: "KOSTEN bitte" });
      await waitFor(() => manager.get(record.id)?.status === "idle", "first turn");
      expect(manager.get(record.id)?.metrics).toMatchObject({ cost: "native", tokens: "unknown" });
      await manager.steer(record.id, { kind: "prompt", text: "ohne" });
      await waitFor(() => (manager.get(record.id)?.metrics as SessionMetricsState).counters.turns === 2, "second turn");
      expect(manager.get(record.id)?.metrics).toMatchObject({ cost: "partial", tokens: "unknown", counters: { turns: 2, costTurns: 1 } });
      const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(record.id) as unknown as SessionRow;
      expect(rowToRecord(row).metrics).toMatchObject({ cost: "partial", tokens: "unknown" });
    } finally {
      await manager.shutdown();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("migration: an older session with a sum > 0 cannot prove every turn — partial, never native", () => {
    const db = new HubDatabase(":memory:");
    db.prepare("DELETE FROM _migrations WHERE id = 15").run();
    db.prepare("ALTER TABLE sessions DROP COLUMN metric_counters").run();
    db.prepare(
      "INSERT INTO sessions (id, adapter, project, status, created_at, adapter_version, cost_usd, tokens_est, updated_at) VALUES ('alt', 'claude', '/p', 'stopped', 'x', '1', 0.5, 0, 'x'), ('leer', 'codex', '/p', 'stopped', 'x', '1', 0, 0, 'x')",
    ).run();
    const reopened = db as unknown as { migrate(): void };
    reopened.migrate();
    const get = (id: string) => rowToRecord(db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as unknown as SessionRow).metrics;
    expect(get("alt")).toMatchObject({ cost: "partial", tokens: "unknown" });
    expect(get("leer")).toMatchObject({ cost: "unknown", tokens: "unknown" });
  });
});
