import { defineConfig } from "vitest/config";
import { tierB } from "./scripts/test-tiers.ts";

/**
 * Tier B — langsam, portbindend oder wanduhrabhängig (Liste in
 * scripts/test-tiers.mjs). Läuft bewusst seriell: die zeitbasierten Tests
 * (BUG-0001/0002) brauchen nacheinander, nicht parallel.
 *
 * `npm run test:slow` — nach `npm test` (Tier A) der zweite Teil des Gates.
 */
export default defineConfig({
  test: {
    globalSetup: ["./scripts/vitest-global-setup.mjs"],
    include: tierB,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: "forks",
    fileParallelism: false,
    maxWorkers: 1,
  },
});
