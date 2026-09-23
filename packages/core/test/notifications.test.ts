import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Adapter } from "@uacc/contracts";
import { basicFeatures } from "@uacc/contracts";
import { providerErrorEvent } from "@uacc/contracts";
import { EventStore, HubDatabase, SessionManager, AdapterRegistry } from "../src/index.ts";
import { ProcessRunner } from "@uacc/workers";

/** One worker per turn; "LIMIT" makes the provider fail with a quota error. */
function provider(): Adapter {
  const turn = async (ctx: Parameters<Adapter["start"]>[1], text: string) => {
    const proc = await ctx.spawnWorker(["sh", "-c", text.includes("LIMIT") ? "sleep 0.1; exit 1" : "sleep 0.1"]);
    if (text.includes("LIMIT")) {
      ctx.emit(providerErrorEvent("fake", "Usage limit reached for 5 hour. Your limit will reset at 2026-09-23 15:00:00"));
      proc.onExit((code) => ctx.emit({ type: "system", summary: `fake: process exited with code ${code}`, payload: { code } }));
    }
  };
  return {
    id: "fake",
    version: "0.0.1",
    capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures({ followUp: true, interrupt: true }) }),
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

async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("notifications feed (ADR-0015)", () => {
  it("records errors, finished turns and approvals once, readable and in order", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uacc-notif-"));
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("fake", provider);
    const manager = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    try {
      await mkdir(join(dir, "tetris"));
      const record = await manager.create({ adapter: "fake", project: join(dir, "tetris"), prompt: "Hallo" });
      await waitFor(() => manager.notifications().items.length >= 1);
      await manager.steer(record.id, { kind: "prompt", text: "LIMIT bitte" });
      await waitFor(() => manager.notifications().items.some((n) => n.level === "error"));
      await new Promise((r) => setTimeout(r, 400));

      const { items, lastId } = manager.notifications();
      const titles = items.map((n) => `${n.level}: ${n.title}`);
      expect(titles).toEqual(["error: tetris · fake: Kontingent erschöpft (5 h)", "success: tetris · Zug fertig"]);
      expect(items[0]?.detail).toContain("2026-09-23 15:00:00");
      expect(items[0]).toMatchObject({ sessionId: record.id, kind: "provider.error" });

      const newer = manager.notifications(items[1]!.id);
      expect(newer.items.map((n) => n.id)).toEqual([items[0]!.id]);
      expect(lastId).toBe(items[0]!.id);
    } finally {
      await manager.shutdown();
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
