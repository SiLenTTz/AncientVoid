import { describe, it } from "vitest";
import { runContractTests, assertContractGreen } from "@uacc/adapter-testkit";
import { createAdapter } from "../src/index.ts";

describe("dummy adapter contract", () => {
  it("passes the hub contract suite", async () => {
    const results = await runContractTests(createAdapter, {
      config: { eventsPerSecond: 20, autoStopAfterEvents: 3 },
    });
    for (const r of results) {
      if (!r.ok) console.error(`  ✗ ${r.name}: ${r.detail}`);
    }
    assertContractGreen(results);
  });
});
