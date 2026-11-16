import { z } from "zod";

/**
 * EPIC-P39 (ADR-0059): Browser-Arbeitsplatz. Chromium läuft auf dem Ausführungshost (Hub-Prozess besitzt Browser und
 * Contexts), die PWA zeigt einen begrenzten Standbild-Strom und schickt schema-validierte Aktionen. Kein CDP, keine
 * freie URL-Eingabe ohne Ursprungsprüfung. Alle Grenzen hier sind Teil des öffentlichen Vertrags.
 */

/** Mobile Viewports sind Fenstergrößen — ausdrücklich kein Gerätesimulator (AC-P39-3). */
export const BROWSER_VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 820, height: 1180 },
  phone: { width: 390, height: 844 },
} as const;
export const BrowserViewportName = z.enum(["desktop", "tablet", "phone"]);
export type BrowserViewportName = z.infer<typeof BrowserViewportName>;

/** K5/K8: harte Grenzen je Host/Session — Frames und Artefakte landen nie als Events. */
export const BROWSER_MAX_CONTEXTS = 4;
export const BROWSER_FRAME_QUALITY = 60;
export const BROWSER_FRAME_MIN_INTERVAL_MS = 120;
export const BROWSER_IDLE_CLOSE_MS = 10 * 60_000;
export const BROWSER_MAX_CONSOLE_ENTRIES = 100;
export const BROWSER_MAX_ARTIFACTS_PER_SESSION = 20;
export const BROWSER_ARTIFACT_MAX_BYTES = 1024 * 1024;
export const BROWSER_MAX_TEST_STEPS = 20;
export const BROWSER_STEP_TIMEOUT_MAX_MS = 10_000;
export const BROWSER_TEST_TOTAL_TIMEOUT_MS = 60_000;
export const BROWSER_PICK_TEXT_MAX_CHARS = 200;

export const BrowserState = z.enum(["unavailable", "closed", "open"]);
export type BrowserState = z.infer<typeof BrowserState>;

export const BrowserLogEntry = z.object({
  at: z.string(),
  kind: z.enum(["console", "pageerror", "network", "blocked"]),
  level: z.string(),
  text: z.string().max(500),
});
export type BrowserLogEntry = z.infer<typeof BrowserLogEntry>;

export const BrowserStatus = z.object({
  sessionId: z.string(),
  state: BrowserState,
  /** Warum der Browser nicht verfügbar ist (Playwright/Chromium fehlen, Startfehler) — nie still leer. */
  unavailableReason: z.string().nullable(),
  url: z.string().nullable(),
  title: z.string().nullable(),
  viewport: BrowserViewportName,
  /** `false` = sichtbares Fenster auf dem Host (Config browserHeadless). */
  headless: z.boolean().default(true),
  /** Ursprünge, die dieser Context erreichen darf (registrierte Services + explizit freigegebene). */
  allowedOrigins: z.array(z.string()),
  canBack: z.boolean(),
  canForward: z.boolean(),
  /** Läuft gerade ein Testjob? Manuelle Eingabe bleibt getrennt (eigener Test-Context). */
  testRunning: z.boolean(),
  log: z.array(BrowserLogEntry),
  openedAt: z.string().nullable(),
});
export type BrowserStatus = z.infer<typeof BrowserStatus>;

const Coord = z.number().min(0).max(10_000);
export const BrowserAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("navigate"), url: z.string().min(1).max(2048) }),
  z.object({ type: z.literal("reload") }),
  z.object({ type: z.literal("back") }),
  z.object({ type: z.literal("forward") }),
  z.object({ type: z.literal("click"), x: Coord, y: Coord }),
  z.object({ type: z.literal("type"), text: z.string().min(1).max(500) }),
  z.object({ type: z.literal("press"), key: z.enum(["Enter", "Tab", "Escape", "Backspace", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) }),
  z.object({ type: z.literal("scroll"), dy: z.number().min(-5000).max(5000) }),
  z.object({ type: z.literal("viewport"), preset: BrowserViewportName }),
]);
export type BrowserAction = z.infer<typeof BrowserAction>;

// ---- Testfälle (registrierte, schema-validierte Schritte — kein hochgeladener JS-Code) ---------------------------
const Selector = z.string().min(1).max(300);
const StepTimeout = z.number().int().min(100).max(BROWSER_STEP_TIMEOUT_MAX_MS).default(5_000);
export const BrowserTestStep = z.discriminatedUnion("type", [
  z.object({ type: z.literal("goto"), url: z.string().min(1).max(2048), timeoutMs: StepTimeout }),
  z.object({ type: z.literal("click"), selector: Selector, timeoutMs: StepTimeout }),
  z.object({ type: z.literal("fill"), selector: Selector, value: z.string().max(500), timeoutMs: StepTimeout }),
  z.object({ type: z.literal("expectText"), selector: Selector, text: z.string().min(1).max(300), timeoutMs: StepTimeout }),
  z.object({ type: z.literal("expectVisible"), selector: Selector, timeoutMs: StepTimeout }),
  z.object({ type: z.literal("expectUrl"), contains: z.string().min(1).max(500), timeoutMs: StepTimeout }),
]);
export type BrowserTestStep = z.infer<typeof BrowserTestStep>;

export const BrowserTestCase = z.object({
  name: z.string().min(1).max(120),
  viewport: BrowserViewportName.default("desktop"),
  steps: z.array(BrowserTestStep).min(1).max(BROWSER_MAX_TEST_STEPS),
});
export type BrowserTestCase = z.infer<typeof BrowserTestCase>;

export const BROWSER_TEST_STATES = ["running", "passed", "failed", "aborted", "unknown"] as const;
export const BrowserTestState = z.enum(BROWSER_TEST_STATES);
export type BrowserTestState = z.infer<typeof BrowserTestState>;

export const BrowserStepResult = z.object({
  index: z.number().int().nonnegative(),
  type: z.string(),
  ok: z.boolean(),
  detail: z.string().max(500).nullable(),
});
export type BrowserStepResult = z.infer<typeof BrowserStepResult>;

export const BrowserTestRun = z.object({
  id: z.string(),
  sessionId: z.string(),
  name: z.string(),
  state: BrowserTestState,
  viewport: BrowserViewportName,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  steps: z.array(BrowserStepResult),
  /** Console-/Netzfehler des Laufs (gekürzt). */
  log: z.array(BrowserLogEntry),
  /** Screenshot-Artefakt (Datei im Datadir, nie im Eventstrom). */
  artifact: z.object({ name: z.string(), bytes: z.number().int().nonnegative() }).nullable(),
  /** Warum `unknown`/`aborted` (z. B. Hub-Neustart während des Laufs). */
  note: z.string().nullable(),
});
export type BrowserTestRun = z.infer<typeof BrowserTestRun>;

// ---- Design-Auswahl -----------------------------------------------------------------------------------------------
export const BROWSER_STYLE_WHITELIST = [
  "color", "background-color", "font-family", "font-size", "font-weight", "line-height", "display", "position",
  "margin", "padding", "border", "border-radius", "width", "height", "opacity",
] as const;

export const BrowserPick = z.object({
  selector: z.string().max(500),
  tag: z.string().max(40),
  text: z.string().max(BROWSER_PICK_TEXT_MAX_CHARS),
  rect: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  styles: z.record(z.string(), z.string().max(200)),
  /** `main` oder `iframe` — Inhalt fremder Frames wird nicht ausgelesen, nur der Frame selbst. */
  frame: z.enum(["main", "iframe"]),
  inShadowDom: z.boolean(),
  /** Passwort-/Secret-Feld: Text und Werte sind ausgelassen. */
  masked: z.boolean(),
  /** Quelle laut Source-Map nur, wenn vorhanden — sonst null (nie geraten). */
  source: z.string().nullable(),
  url: z.string(),
});
export type BrowserPick = z.infer<typeof BrowserPick>;

export const BrowserFeedbackInput = z.object({
  pick: BrowserPick,
  note: z.string().max(2000),
  includeScreenshot: z.boolean().default(true),
  targetSessionId: z.string().min(1).optional(),
  operationId: z.string().min(8).max(128).optional(),
});
export type BrowserFeedbackInput = z.infer<typeof BrowserFeedbackInput>;
