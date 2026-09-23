import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Adapter } from "@uacc/contracts";
import { EventStore, HubDatabase, SessionManager, AdapterRegistry } from "../src/index.ts";
import { ProcessRunner } from "@uacc/workers";

/** Like every real CLI adapter: one worker process per turn. */
function oneProcessPerTurn(): Adapter {
  const spawnTurn = (ctx: Parameters<Adapter["start"]>[1], text: string) =>
    ctx.spawnWorker(["sh", "-c", text.includes("FAIL") ? "sleep 0.2; exit 3" : "sleep 0.2"]);
  return {
    id: "turns",
    version: "0.0.1",
    capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none" }),
    async start(spec, ctx) {
      await spawnTurn(ctx, spec.prompt ?? "");
      return { sessionId: ctx.sessionId };
    },
    async steer(_handle, input, ctx) {
      if (input.kind === "prompt") await spawnTurn(ctx, input.text);
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

describe("turn state (T5.4)", () => {
  it("is working while a turn runs and idle between turns", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uacc-turns-"));
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("turns", oneProcessPerTurn);
    const manager = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    try {
      const record = await manager.create({ adapter: "turns", project: dir, prompt: "eins" });
      expect(manager.get(record.id)?.status).toBe("working");
      await waitFor(() => manager.get(record.id)?.status === "idle", "idle after first turn");

      expect((await manager.steer(record.id, { kind: "prompt", text: "zwei" })).ok).toBe(true);
      expect(manager.get(record.id)?.status).toBe("working");
      await waitFor(() => manager.get(record.id)?.status === "idle", "idle after second turn");

      const ends = (await manager.tail(record.id, 0)).filter((e) => (e.payload as { kind?: string }).kind === "session.turn_end");
      expect(ends).toHaveLength(2);
    } finally {
      await manager.shutdown();
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("a failed turn does not look idle", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uacc-turns-"));
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("turns", oneProcessPerTurn);
    const manager = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    try {
      const record = await manager.create({ adapter: "turns", project: dir, prompt: "FAIL" });
      await new Promise((r) => setTimeout(r, 800));
      expect(manager.get(record.id)?.status).toBe("working");
    } finally {
      await manager.shutdown();
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("after a failed turn in error state, the next prompt runs again (ADR-0015)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uacc-turns-"));
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("turns", () => ({ ...oneProcessPerTurn(), status: async () => ({ state: "down" as const }) }));
    const manager = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    try {
      const record = await manager.create({ adapter: "turns", project: dir, prompt: "FAIL" });
      await new Promise((r) => setTimeout(r, 500));
      await manager.runHeartbeat();
      expect(manager.get(record.id)?.status).toBe("error");
      expect((await manager.steer(record.id, { kind: "prompt", text: "nochmal" })).ok).toBe(true);
      expect(manager.get(record.id)?.status).toBe("working");
      await waitFor(() => manager.get(record.id)?.status === "idle", "idle after the retry");
    } finally {
      await manager.shutdown();
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
