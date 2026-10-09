import { defineConfig, devices } from "@playwright/test";

/**
 * E2E gate (EPIC-P5 §7 DoD, docs/testing-e2e.md). Every test boots its own
 * real hub process with fake provider CLIs — see e2e/support/hub.ts.
 *
 * Mobile (Pixel 7) is the primary target and runs every spec. The desktop
 * project runs specs tagged @desktop; the handoff spec drives both form
 * factors itself.
 */
/** Auf dem Handy lauffähig: eine Seite, kein Mikrofon/Kamera/Push-Dialog, kein zweiter Hub. */
const PHONE_SPECS = [
  "session.spec.ts",
  "steer.spec.ts",
  "modus-modell.spec.ts",
  "pause-queue.spec.ts",
  "thinking-leer.spec.ts",
  "flackern.spec.ts",
  "session-scroll.spec.ts",
  "ruhe-beim-tippen.spec.ts",
  "pc-offen.spec.ts",
  "workspace.spec.ts",
];

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
    // Das echte Handy per adb/CDP: `npm run test:phone` (scripts/phone-e2e.mjs, docs/testing-e2e.md).
    // Nur Specs, die ohne Mikrofon, Kamera, zweiten Browserkontext und fremde Hubs auskommen.
    { name: "phone", testMatch: PHONE_SPECS, retries: 0 },
  ],
});
