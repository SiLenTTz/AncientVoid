import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke test against a RUNNING hub (after each epic: restart, then this).
 * Read-only: no session is started, nothing is decided, nothing costs.
 *
 *   ANCIENTVOID_LIVE_URL=http://127.0.0.1:7373 ANCIENTVOID_LIVE_TOKEN=… npx playwright test -c playwright.live.config.ts
 *
 * `npm run test:live` issues a temporary device token and revokes it.
 */
export default defineConfig({
  testDir: "e2e/live",
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: { locale: "de-DE", serviceWorkers: "block", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "mobile", use: { ...devices["Pixel 7"] } }],
});
