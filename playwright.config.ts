import { defineConfig, devices } from "@playwright/test";

/**
 * E2E gate (EPIC-P5 §7 DoD, docs/testing-e2e.md). Every test boots its own
 * real hub process with fake provider CLIs — see e2e/support/hub.ts.
 *
 * Mobile (Pixel 7) is the primary target and runs every spec. The desktop
 * project runs specs tagged @desktop; the handoff spec drives both form
 * factors itself.
 */
export default defineConfig({
  testDir: "e2e/specs",
  globalSetup: "./e2e/support/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : 4,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [["list"], ["junit", { outputFile: "test-results/e2e-junit.xml" }], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    locale: "de-DE",
    serviceWorkers: "block",
  },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, grep: /@desktop/ },
  ],
});
