import { describe, expect, it } from "vitest";
import type { Adapter, WorkerProcess } from "@ancientvoid/contracts";
import { basicFeatures } from "@ancientvoid/contracts";
import { runContractTests } from "../src/index.ts";

function spawnAdapter(): Adapter {
  return {
    id: "spawny",
    version: "1.0.0",
    capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: false, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures({ followUp: false, interrupt: false }) }),
    async start(_spec, ctx) {
      await ctx.spawnWorker(["echo", "hi"]);
      ctx.emit({ type: "system", summary: "started", payload: {} });
      return { sessionId: ctx.sessionId };
    },
    async steer() {
      return { ok: true };
    },
    async status() {
      return { state: "degraded" };
    },
    async stop() {
      return undefined;
    },
  };
}

function fakeWorker(): WorkerProcess {
  return {
    onStdout() {
      return undefined;
    },
    onStderr() {
      return undefined;
    },
    onExit() {
      return undefined;
    },
    write() {
      return undefined;
    },
    async kill() {
      return undefined;
    },
    async exited() {
      return { code: 0 };
    },
  };
}

describe("runContractTests spawnWorker override (BUG-0004)", () => {
  it("fails start when the adapter spawns and no mock is provided", async () => {
    const results = await runContractTests(() => spawnAdapter(), { skipRecover: true });
    const start = results.find((result) => result.name.startsWith("start("));
    expect(start?.ok).toBe(false);
    expect(start?.detail).toMatch(/spawnWorker not simulated/);
  });

  it("passes when a spawnWorker mock is injected", async () => {
    const results = await runContractTests(() => spawnAdapter(), {
      skipRecover: true,
      spawnWorker: async () => fakeWorker(),
    });
    expect(results.filter((result) => !result.ok)).toEqual([]);
  });
});