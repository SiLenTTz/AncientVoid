import { defineConfig } from "vitest/config";
import { tierB } from "./scripts/test-tiers.ts";

/**
 * Tier A — der schnelle Loop (`npm test`, `npm run test:watch`).
 * Ausgeschlossen ist, was lang ist, echte Ports bindet oder auf Wanduhr-Zeit
 * prüft; dieser Teil läuft seriell in vitest.slow.config.ts (`npm run
 * test:slow`). Liste: scripts/test-tiers.ts. Beide Tiers zusammen fahren
 * `npm run gate` und die CI — nichts verschwindet still aus der Prüfung.
 */
export default defineConfig({
  test: {
    globalSetup: ["./scripts/vitest-global-setup.mjs"],
    include: ["packages/*/test/**/*.test.ts", "packages/adapters/*/test/**/*.test.ts", "packages/loops/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts", "scripts/**/*.test.mjs"],
    exclude: ["**/node_modules/**", "**/dist/**", ...tierB],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    pool: "forks",
  },
});
