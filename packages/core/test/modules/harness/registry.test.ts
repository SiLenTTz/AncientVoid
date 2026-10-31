import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry } from "../../../src/modules/harness/registry.ts";

/** A minimal third-party adapter written to a local file — the contributor path. */
const CUSTOM_ADAPTER = `
export function createAdapter(config) {
  return {
    id: "custom-endpoint",
    version: "0.0.1",
    capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: false, usage: false, nativeDiscovery: "none", nativeResume: "none" }),
    async start(spec, ctx) { ctx.emit({ type: "system", summary: "custom started", payload: {} }); return { sessionId: ctx.sessionId }; },
    async steer() { return { ok: true }; },
    async status() { return { state: "healthy" }; },
    async stop() {},
  };
}
`;

describe("AdapterRegistry", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-reg-"));
    const adaptersDir = join(dir, "adapters");
    await mkdir(adaptersDir, { recursive: true });
    await writeFile(join(adaptersDir, "custom.mjs"), CUSTOM_ADAPTER);
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loads an adapter from a local file path (contributor scenario)", async () => {
    const registry = new AdapterRegistry();
    await registry.load(
      { id: "custom", module: "./adapters/custom.mjs", enabled: true },
      join(dir, "hub.config.json"),
    );
    const found = registry.require("custom");
    expect(found.adapter.id).toBe("custom-endpoint");
    expect(found.capabilities.steer).toBe(false);
    // ADR-0018: an adapter written before `features` gets the cautious
    // reading — no follow-up, and tools (if any) as if they ran unasked.
    expect(found.capabilities.features).toMatchObject({ followUp: false, interrupt: false, toolGate: "none", questions: false });
  });

  it("fails loudly on modules without createAdapter export", async () => {
    const registry = new AdapterRegistry();
    await expect(
      registry.load({ id: "broken", module: "./adapters/missing.mjs", enabled: true }, join(dir, "x.json")),
    ).rejects.toThrow();
  });

  it("loadAll skips disabled registrations", async () => {
    const registry = new AdapterRegistry();
    await registry.loadAll(
      [
        { id: "off", module: "./adapters/missing.mjs", enabled: false },
      ],
      join(dir, "x.json"),
    );
    expect(registry.list().length).toBe(0);
  });
});
