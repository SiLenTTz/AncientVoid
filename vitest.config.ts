import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "e2e/**/*.test.ts"],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
