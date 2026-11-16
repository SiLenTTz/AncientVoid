import { describe, it } from "vitest";
import { runContractTests, assertContractGreen } from "@ancientvoid/adapter-testkit";
import { createAdapter } from "../src/index.ts";

describe("dummy adapter contract", () => {
  it.each([false, true])("passes the hub contract suite (hubResume=%s)", async (hubResume) => {
    const results = await runContractTests(createAdapter, {
      config: { hubResume, eventsPerSecond: 20, autoStopAfterEvents: 3 },
    });
    for (const r of results) {
      if (!r.ok) console.error(`  ✗ ${r.name}: ${r.detail}`);
    }
    assertContractGreen(results);
  });
});
