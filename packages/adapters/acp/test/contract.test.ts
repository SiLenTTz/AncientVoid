import { describe, it } from "vitest";
import { chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runContractTests, assertContractGreen } from "@ancientvoid/adapter-testkit";
import { ProcessRunner } from "@ancientvoid/workers";
import { createAdapter } from "../src/index.ts";

const agent = fileURLToPath(new URL("../../../../e2e/support/bin/acp-agent", import.meta.url));
chmodSync(agent, 0o755);

describe("acp adapter contract", () => {
  it("passes the hub contract suite against a real ACP agent process", async () => {
    const runner = new ProcessRunner();
    const results = await runContractTests(createAdapter, {
      config: { command: [agent] },
      skipRecover: true,
      spawnWorker: (cmd, o) => runner.spawn({ name: "acp-contract", cwd: process.cwd(), cmd, ...(o?.env ? { env: o.env } : {}) }),
    });
    for (const r of results) {
      if (!r.ok) console.error(`  ✗ ${r.name}: ${r.detail}`);
    }
    assertContractGreen(results);
  });
});
