import { defineConfig, devices } from "@playwright/test";

/**
 * E2E gate (EPIC-P5 §7 DoD, docs/testing-e2e.md). Every test boots its own
 * real hub process with fake provider CLIs — see e2e/support/hub.ts.
 *
 * Mobile (Pixel 7) is the primary target and runs every spec. The tablet
 * project (800×1280, touch) covers the gap to the desktop project — portrait
 * must keep the phone layout, landscape hits the 1280-px split boundary
 * (T8.5/AC-P8-6) on a touch device, which neither mobile nor desktop (mouse)
 * exercise. It runs specs tagged @tablet; the desktop project runs specs
 * tagged @desktop; the handoff spec drives both form factors itself.
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
  "code.spec.ts",
  "browser-workspace.spec.ts",
  // EPIC-P43 T43.9: Geräteabnahme des Umbaus.
  "start-warteschlange.spec.ts",
  "chat-zuege.spec.ts",
  "kleinkram.spec.ts",
  "nyx-blatt.spec.ts",
  "schnellsuche.spec.ts",
  "tastatur-screenreader.spec.ts",
  "funktionsinventar.spec.ts",
];

export default defineConfig({
  testDir: "e2e/specs",
  globalSetup: "./e2e/support/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // CI: 1 Worker statt 2 — der Projekt-Runner teilt sich 8 CPUs mit je zwei
  // echten Hubs und Chromium pro Test (ADR-0049); Parallellast erzeugte
  // Timing-Fenster (BUG-0093/0094/0095). Keine Retries, keine gelockerten
  // Assertions — nur der Parallelitätsgrad der geteilten Hardware angepasst.
  // Lokal (BUG-0111): 2 statt 4 — die Maschine ist geteilter Dev-Desktop;
  // 4 Worker × (Hub + Chromium) auf einem 16-Core-Desktop schoben den
  // Nutzer-Browser in den Immediate-Crash (SIGTRAP, Crashpad-Dumps 09.09.–01.11.).
  workers: process.env.CI ? 1 : 2,
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
    // Galaxy-Tab-Klasse als CSS-Viewport (Playwrights „Galaxy Tab S9“-Deskriptor
    // ist nur 640 px breit): Portrait 800 px < WIDE, Querformat exakt 1280 px —
    // die Grenze aus main.tsx useWide() auf einem Touch-Gerät.
    {
      name: "tablet",
      use: { viewport: { width: 800, height: 1280 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
      grep: /@tablet/,
    },
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, grep: /@desktop/ },
    // Das echte Handy per adb/CDP: `npm run test:phone` setzt ANCIENTVOID_E2E_CDP.
    // Ohne das hängt das Projekt nicht am Gate — sonst laufen dieselben Specs
    // lokal ohne Gerätefläche und scheitern an der Desktop-Breite.
    ...(process.env.ANCIENTVOID_E2E_CDP ? [{ name: "phone", testMatch: PHONE_SPECS, retries: 0 }] : []),
  ],
});
