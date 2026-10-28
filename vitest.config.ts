import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "packages/adapters/*/test/**/*.test.ts", "packages/loops/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts", "scripts/**/*.test.mjs"],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    pool: "forks",
    // Ersatz für poolOptions.forks.singleFork (seit vitest 4 entfernt): die
    // zeitbasierten Tests (BUG-0001/0002) laufen nacheinander, nicht parallel.
    maxWorkers: 1,
  },
});
