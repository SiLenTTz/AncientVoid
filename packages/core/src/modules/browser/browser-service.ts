import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Browser, BrowserContext, Page } from "playwright";
import {
  BROWSER_ARTIFACT_MAX_BYTES,
  BROWSER_FRAME_MIN_INTERVAL_MS,
  BROWSER_FRAME_QUALITY,
  BROWSER_IDLE_CLOSE_MS,
  BROWSER_MAX_ARTIFACTS_PER_SESSION,
  BROWSER_MAX_CONSOLE_ENTRIES,
  BROWSER_MAX_CONTEXTS,
  BROWSER_TEST_TOTAL_TIMEOUT_MS,
  BROWSER_VIEWPORTS,
} from "@ancientvoid/contracts";
import type {
  BrowserAction,
  BrowserLogEntry,
  BrowserPick,
  BrowserStatus,
  BrowserTestCase,
  BrowserTestRun,
  BrowserTestStep,
  BrowserViewportName,
} from "@ancientvoid/contracts";
import { allowedOriginSet, checkUrl, checkWebSocketUrl, resolveTarget } from "./target-guard.ts";
import { PICK_ARGS, pickInPage, type PickRaw } from "./pick-script.ts";

/**
 * EPIC-P39 (ADR-0059): Browser-Dienst. Der Hub-Prozess besitzt EINEN Headless-Chromium und je Session einen
 * isolierten Context (inkognito: eigene Cookies/Storage, kein Profil aus einem persönlichen Browser). Es gibt keinen
 * CDP-Port nach außen; Eingaben sind schema-validierte Aktionen. Der Browser wird nur bei Bedarf gestartet und
 * beendet, sobald kein Context mehr offen ist. Fällt er aus, bleibt der Hub unberührt (K7).
 */
export type BrowserErrorCode = "unavailable" | "quota" | "blocked" | "closed" | "not_found" | "busy" | "failed";
export class BrowserError extends Error {
  readonly code: BrowserErrorCode;
  constructor(code: BrowserErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface BrowserServiceOptions {
  dataDir: string;
  /** Zusätzliche Test-Origins aus der Config. */
  extraOrigins?: string[];
  /** Ports der laufenden, registrierten Workspace-Services einer Session. */
  portsFor: (sessionId: string) => Promise<number[]>;
  maxContexts?: number;
  /** Ownership-Cleanup: Contexts beendeter/archivierter/gelöschter Sessions werden vom Reaper geschlossen. */
  isActive?: (sessionId: string) => boolean;
  /** Test-Naht: eigener Launcher statt Playwright. */
  launcher?: () => Promise<Browser>;
}

interface Live {
  context: BrowserContext;
  page: Page;
  viewport: BrowserViewportName;
  allowed: Set<string>;
  log: BrowserLogEntry[];
  openedAt: string;
  lastUsed: number;
  lastFrame: { at: number; seq: number; data: Buffer } | null;
  seq: number;
}

interface ActiveTest {
  runId: string;
  controller: AbortController;
  context: BrowserContext;
}

const now = () => new Date().toISOString();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export class BrowserService {
  private readonly dataDir: string;
  private readonly extra: string[];
  private readonly portsFor: (sessionId: string) => Promise<number[]>;
  private readonly maxContexts: number;
  private readonly launcher: () => Promise<Browser>;
  private readonly isActive: (sessionId: string) => boolean;
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private unavailable: string | null = null;
  private readonly live = new Map<string, Live>();
  private readonly tests = new Map<string, ActiveTest>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private reaper: NodeJS.Timeout | null = null;
  private readonly reapEveryMs = 15_000;

  constructor(opts: BrowserServiceOptions) {
    this.dataDir = join(opts.dataDir, "browser");
    this.extra = opts.extraOrigins ?? [];
    this.portsFor = opts.portsFor;
    this.maxContexts = opts.maxContexts ?? BROWSER_MAX_CONTEXTS;
    this.isActive = opts.isActive ?? (() => true);
    this.launcher = opts.launcher ?? (() => this.launchChromium());
  }

  // ---- Browser-Prozess ---------------------------------------------------------------------------------------
  private async launchChromium(): Promise<Browser> {
    const { chromium } = await import("playwright");
    return chromium.launch({
      headless: true,
      // Netzwerkebene zusätzlich zur Request-Prüfung: nur Loopback wird aufgelöst (DNS-Rebinding, Exfiltration).
      args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost", "--disable-background-networking", "--no-first-run"],
    });
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    this.launching ??= this.launcher()
      .then((b) => {
        this.browser = b;
        this.unavailable = null;
        b.on("disconnected", () => {
          this.browser = null;
          for (const [id, l] of this.live) if (!l.context.browser()?.isConnected()) this.live.delete(id);
        });
        return b;
      })
      .catch((err) => {
        this.unavailable = clip(err instanceof Error ? err.message.split("\n")[0]! : String(err), 300);
        throw new BrowserError("unavailable", `Browser nicht verfügbar: ${this.unavailable}`);
      })
      .finally(() => {
        this.launching = null;
      });
    return this.launching;
  }

  private contextCount(): number {
    return this.live.size + this.tests.size;
  }

  private async maybeCloseBrowser(): Promise<void> {
    if (this.contextCount() === 0 && this.browser) {
      const b = this.browser;
      this.browser = null;
      await b.close().catch(() => undefined);
    }
    if (this.contextCount() === 0 && this.reaper) {
      clearInterval(this.reaper);
      this.reaper = null;
    }
  }

  private startReaper(): void {
    if (this.reaper) return;
    this.reaper = setInterval(() => {
      for (const [id, l] of this.live) if (!this.isActive(id) || Date.now() - l.lastUsed > BROWSER_IDLE_CLOSE_MS) void this.close(id);
    }, this.reapEveryMs);
    this.reaper.unref();
  }

  /** Pro Session serialisieren — manuelle Aktionen überlappen sich nie. */
  private async locked<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(sessionId) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    this.locks.set(sessionId, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(sessionId) === next) this.locks.delete(sessionId);
    }
  }

  // ---- Context ------------------------------------------------------------------------------------------------------
  private async newGuardedContext(allowedRef: { set: Set<string> }, log: BrowserLogEntry[], viewport: BrowserViewportName): Promise<BrowserContext> {
    const browser = await this.ensureBrowser();
    const context = await browser.newContext({
      viewport: BROWSER_VIEWPORTS[viewport],
      acceptDownloads: false,
      serviceWorkers: "block",
      permissions: [],
      javaScriptEnabled: true,
      ignoreHTTPSErrors: false,
    });
    const push = (entry: Omit<BrowserLogEntry, "at">) => {
      log.push({ at: now(), ...entry, text: clip(entry.text, 500) });
      if (log.length > BROWSER_MAX_CONSOLE_ENTRIES) log.splice(0, log.length - BROWSER_MAX_CONSOLE_ENTRIES);
    };
    // Jeder Request (auch jeder Redirect-Schritt) läuft durch die Zielprüfung.
    await context.route("**/*", async (route) => {
      const url = route.request().url();
      if (url.startsWith("data:") || url.startsWith("blob:") || url === "about:blank") return route.continue();
      const verdict = checkUrl(url, allowedRef.set);
      if (!verdict.ok) {
        push({ kind: "blocked", level: "error", text: `${url} — ${verdict.reason}` });
        return route.abort("blockedbyclient");
      }
      // Redirects nicht dem Browser überlassen (route.continue() folgt ihnen intern, ohne erneute Prüfung):
      // selbst holen, Location prüfen und die 3xx-Antwort ausliefern — der Browser stellt dann einen neuen,
      // wieder geprüften Request.
      try {
        const response = await route.fetch({ maxRedirects: 0, timeout: 30_000 });
        const status = response.status();
        const location = response.headers()["location"];
        if (status >= 300 && status < 400 && location) {
          const next = checkUrl(new URL(location, url).toString(), allowedRef.set);
          if (!next.ok) {
            push({ kind: "blocked", level: "error", text: `Redirect von ${url} nach ${location} — ${next.reason}` });
            return await route.abort("blockedbyclient");
          }
        }
        return await route.fulfill({ response });
      } catch (err) {
        push({ kind: "network", level: "error", text: `${url} — ${err instanceof Error ? err.message.split("\n")[0] : "Abruf fehlgeschlagen"}` });
        return route.abort("failed").catch(() => undefined);
      }
    });
    await context.routeWebSocket(/.*/, (ws) => {
      const verdict = checkWebSocketUrl(ws.url(), allowedRef.set);
      if (!verdict.ok) {
        push({ kind: "blocked", level: "error", text: `WebSocket ${ws.url()} — ${verdict.reason}` });
        void ws.close({ code: 1008, reason: "blocked" });
        return;
      }
      ws.connectToServer();
    });
    context.on("page", (p) => {
      p.on("console", (m) => {
        if (m.type() === "error" || m.type() === "warning") push({ kind: "console", level: m.type(), text: m.text() });
      });
      p.on("pageerror", (e) => push({ kind: "pageerror", level: "error", text: e.message }));
      p.on("requestfailed", (r) => {
        if (r.failure()?.errorText !== "net::ERR_BLOCKED_BY_CLIENT") push({ kind: "network", level: "error", text: `${r.method()} ${r.url()} — ${r.failure()?.errorText ?? "fehlgeschlagen"}` });
      });
      p.on("response", (r) => {
        if (r.status() >= 400) push({ kind: "network", level: "error", text: `${r.status()} ${r.url()}` });
      });
    });
    return context;
  }

  private async refreshAllowed(sessionId: string, l?: Live): Promise<Set<string>> {
    const set = allowedOriginSet(await this.portsFor(sessionId).catch(() => []), this.extra);
    if (l) {
      l.allowed.clear();
      for (const o of set) l.allowed.add(o);
    }
    return set;
  }

  // ---- Öffentliche Operationen --------------------------------------------------------------------------------
  async status(sessionId: string): Promise<BrowserStatus> {
    const l = this.live.get(sessionId);
    const allowed = await this.refreshAllowed(sessionId, l);
    const base = {
      sessionId,
      allowedOrigins: [...allowed],
      testRunning: this.runningFor(sessionId),
    };
    if (!l) {
      return { ...base, state: this.unavailable ? "unavailable" : "closed", unavailableReason: this.unavailable, url: null, title: null, viewport: "desktop", canBack: false, canForward: false, log: [], openedAt: null };
    }
    // Navigation API (Chromium): ehrlicher Zustand statt immer aktiver Knöpfe.
    const nav = await l.page.evaluate(() => {
      const n = (window as unknown as { navigation?: { canGoBack: boolean; canGoForward: boolean } }).navigation;
      return { back: n?.canGoBack ?? false, forward: n?.canGoForward ?? false };
    }).catch(() => ({ back: false, forward: false }));
    return {
      ...base,
      state: "open",
      unavailableReason: null,
      url: l.page.url() === "about:blank" ? null : l.page.url(),
      title: await l.page.title().catch(() => null),
      viewport: l.viewport,
      canBack: nav.back,
      canForward: nav.forward,
      log: [...l.log],
      openedAt: l.openedAt,
    };
  }

  private runningFor(sessionId: string): boolean {
    return [...this.tests.keys()].some((k) => k.startsWith(`${sessionId}:`));
  }

  async open(sessionId: string, url?: string): Promise<BrowserStatus> {
    return this.locked(sessionId, async () => {
      let l = this.live.get(sessionId);
      if (!l) {
        if (this.contextCount() >= this.maxContexts) throw new BrowserError("quota", `Höchstens ${this.maxContexts} Browser-Kontexte gleichzeitig — bitte einen anderen schließen.`);
        const allowedRef = { set: await this.refreshAllowed(sessionId) };
        const log: BrowserLogEntry[] = [];
        const context = await this.newGuardedContext(allowedRef, log, "desktop");
        const page = await context.newPage();
        context.on("page", (p) => {
          if (p !== page) {
            log.push({ at: now(), kind: "blocked", level: "warning", text: "Neues Fenster wurde geschlossen (nur ein Tab je Kontext)." });
            void p.close().catch(() => undefined);
          }
        });
        l = { context, page, viewport: "desktop", allowed: allowedRef.set, log, openedAt: now(), lastUsed: Date.now(), lastFrame: null, seq: 0 };
        this.live.set(sessionId, l);
        this.startReaper();
      }
      l.lastUsed = Date.now();
      if (url) await this.navigate(sessionId, l, url);
      return this.status(sessionId);
    });
  }

  private async navigate(sessionId: string, l: Live, input: string): Promise<void> {
    await this.refreshAllowed(sessionId, l);
    const verdict = resolveTarget(input, l.allowed);
    if (!verdict.ok) throw new BrowserError("blocked", verdict.reason);
    try {
      await l.page.goto(verdict.url, { timeout: 15_000, waitUntil: "domcontentloaded" });
    } catch (err) {
      throw new BrowserError("failed", `Seite nicht erreichbar: ${clip(err instanceof Error ? err.message.split("\n")[0]! : String(err), 200)}`);
    }
  }

  async act(sessionId: string, action: BrowserAction): Promise<BrowserStatus> {
    return this.locked(sessionId, async () => {
      const l = this.live.get(sessionId);
      if (!l) throw new BrowserError("closed", "Der Browser ist nicht geöffnet.");
      l.lastUsed = Date.now();
      l.lastFrame = null;
      const page = l.page;
      switch (action.type) {
        case "navigate": await this.navigate(sessionId, l, action.url); break;
        case "reload": await page.reload({ timeout: 15_000, waitUntil: "domcontentloaded" }).catch(() => undefined); break;
        case "back": await page.goBack({ timeout: 15_000, waitUntil: "domcontentloaded" }).catch(() => undefined); break;
        case "forward": await page.goForward({ timeout: 15_000, waitUntil: "domcontentloaded" }).catch(() => undefined); break;
        case "click": await page.mouse.click(action.x, action.y); break;
        case "type": await page.keyboard.type(action.text); break;
        case "press": await page.keyboard.press(action.key); break;
        case "scroll": await page.mouse.wheel(0, action.dy); break;
        case "viewport":
          l.viewport = action.preset;
          await page.setViewportSize(BROWSER_VIEWPORTS[action.preset]);
          break;
      }
      return this.status(sessionId);
    });
  }

  /** Letztes Bild (begrenzt in Rate und Größe); `null`, wenn der Browser nicht offen ist. */
  async frame(sessionId: string): Promise<{ data: Buffer; seq: number } | null> {
    const l = this.live.get(sessionId);
    if (!l) return null;
    l.lastUsed = Date.now();
    if (l.lastFrame && Date.now() - l.lastFrame.at < BROWSER_FRAME_MIN_INTERVAL_MS) return l.lastFrame;
    const data = await l.page.screenshot({ type: "jpeg", quality: BROWSER_FRAME_QUALITY, animations: "disabled", timeout: 5_000 }).catch(() => null);
    if (!data) return l.lastFrame;
    l.lastFrame = { at: Date.now(), seq: ++l.seq, data };
    return l.lastFrame;
  }

  async screenshot(sessionId: string, area?: { x: number; y: number; width: number; height: number }): Promise<Buffer | null> {
    const l = this.live.get(sessionId);
    if (!l) return null;
    const shot = await l.page.screenshot({ type: "png", animations: "disabled", timeout: 8_000, ...(area && area.width > 0 && area.height > 0 ? { clip: area } : {}) }).catch(() => null);
    return shot && shot.length <= BROWSER_ARTIFACT_MAX_BYTES * 4 ? shot : null;
  }

  async pick(sessionId: string, x: number, y: number): Promise<BrowserPick> {
    const l = this.live.get(sessionId);
    if (!l) throw new BrowserError("closed", "Der Browser ist nicht geöffnet.");
    l.lastUsed = Date.now();
    const raw = (await l.page.evaluate(pickInPage, PICK_ARGS(x, y)).catch(() => null)) as PickRaw;
    if (!raw) throw new BrowserError("not_found", "An dieser Stelle gibt es kein Element.");
    return { ...raw, source: null, url: l.page.url() };
  }

  async close(sessionId: string): Promise<void> {
    const l = this.live.get(sessionId);
    this.live.delete(sessionId);
    for (const [key, t] of this.tests) if (key.startsWith(`${sessionId}:`)) t.controller.abort();
    if (l) await l.context.close().catch(() => undefined);
    await this.maybeCloseBrowser();
  }

  async closeAll(): Promise<void> {
    for (const id of [...this.live.keys()]) await this.close(id);
    for (const t of this.tests.values()) t.controller.abort();
    await this.maybeCloseBrowser();
  }

  // ---- Testläufe (T39.4) ----------------------------------------------------------------------------------------
  private sessionDir(sessionId: string): string {
    const dir = join(this.dataDir, sessionId.replace(/[^\w-]/g, "_"));
    mkdirSync(join(dir, "artifacts"), { recursive: true });
    return dir;
  }

  private journal(run: BrowserTestRun): void {
    appendFileSync(join(this.sessionDir(run.sessionId), "tests.jsonl"), `${JSON.stringify(run)}\n`);
  }

  /** Gefaltet aus dem Journal; ein `running`-Lauf ohne lebenden Prozess ist `unknown` (K7: nie erfundener Erfolg). */
  listTests(sessionId: string): BrowserTestRun[] {
    const file = join(this.dataDir, sessionId.replace(/[^\w-]/g, "_"), "tests.jsonl");
    if (!existsSync(file)) return [];
    const byId = new Map<string, BrowserTestRun>();
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const run = JSON.parse(line) as BrowserTestRun;
        byId.set(run.id, run);
      } catch {
        // beschädigte Zeile: übersprungen, Rest bleibt lesbar
      }
    }
    return [...byId.values()]
      .map((r) => (r.state === "running" && !this.tests.has(`${sessionId}:${r.id}`) ? { ...r, state: "unknown" as const, note: "Der Hub wurde während des Laufs beendet — Ergebnis unbekannt, nichts wird wiederholt." } : r))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, 50);
  }

  artifactPath(sessionId: string, runId: string): string | null {
    const file = join(this.dataDir, sessionId.replace(/[^\w-]/g, "_"), "artifacts", `${runId.replace(/[^\w-]/g, "_")}.png`);
    return existsSync(file) ? file : null;
  }

  private pruneArtifacts(sessionId: string): void {
    const dir = join(this.sessionDir(sessionId), "artifacts");
    const files = readdirSync(dir).map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const old of files.slice(BROWSER_MAX_ARTIFACTS_PER_SESSION)) unlinkSync(join(dir, old.f));
  }

  /** Startet den Lauf und gibt sofort den `running`-Eintrag zurück; der Abschluss läuft im Hintergrund. */
  async runTest(sessionId: string, test: BrowserTestCase): Promise<BrowserTestRun> {
    if (this.runningFor(sessionId)) throw new BrowserError("busy", "In dieser Session läuft schon ein Testlauf.");
    if (this.contextCount() >= this.maxContexts) throw new BrowserError("quota", `Höchstens ${this.maxContexts} Browser-Kontexte gleichzeitig.`);
    const allowedRef = { set: await this.refreshAllowed(sessionId) };
    const log: BrowserLogEntry[] = [];
    // Eigener Context: der manuelle Browser und der Test schreiben nie in dieselben Cookies/Seiten.
    const context = await this.newGuardedContext(allowedRef, log, test.viewport);
    const runId = randomUUID();
    const key = `${sessionId}:${runId}`;
    const controller = new AbortController();
    this.tests.set(key, { runId: key, controller, context });
    this.startReaper();
    const run: BrowserTestRun = { id: runId, sessionId, name: test.name, state: "running", viewport: test.viewport, startedAt: now(), finishedAt: null, steps: [], log: [], artifact: null, note: null };
    this.journal(run);
    void this.execute(sessionId, run, test, context, allowedRef.set, log, controller).finally(async () => {
      this.tests.delete(key);
      await context.close().catch(() => undefined);
      await this.maybeCloseBrowser();
    });
    return run;
  }

  abortTest(sessionId: string, runId: string): boolean {
    const t = this.tests.get(`${sessionId}:${runId}`);
    if (!t) return false;
    t.controller.abort();
    return true;
  }

  private async execute(sessionId: string, run: BrowserTestRun, test: BrowserTestCase, context: BrowserContext, allowed: Set<string>, log: BrowserLogEntry[], controller: AbortController): Promise<void> {
    const deadline = setTimeout(() => controller.abort("timeout"), BROWSER_TEST_TOTAL_TIMEOUT_MS);
    const finish = async (state: BrowserTestRun["state"], note: string | null, page?: Page) => {
      let artifact: BrowserTestRun["artifact"] = null;
      if (page) {
        const shot = await page.screenshot({ type: "png", timeout: 5_000 }).catch(() => null);
        if (shot && shot.length <= BROWSER_ARTIFACT_MAX_BYTES) {
          const name = `${run.id}.png`;
          writeFileSync(join(this.sessionDir(sessionId), "artifacts", name), shot);
          artifact = { name, bytes: shot.length };
          this.pruneArtifacts(sessionId);
        }
      }
      this.journal({ ...run, state, finishedAt: now(), log: log.slice(-30), artifact, note });
    };
    let page: Page | undefined;
    try {
      page = await context.newPage();
      for (let i = 0; i < test.steps.length; i++) {
        if (controller.signal.aborted) {
          await finish(controller.signal.reason === "timeout" ? "failed" : "aborted", controller.signal.reason === "timeout" ? "Gesamtzeit überschritten" : "Abgebrochen", page);
          return;
        }
        const step = test.steps[i]!;
        const res = await this.runStep(page, step, allowed);
        run.steps.push({ index: i, type: step.type, ok: res === null, detail: res });
        if (res !== null) {
          await finish("failed", null, page);
          return;
        }
      }
      await finish("passed", null, page);
    } catch (err) {
      await finish("failed", clip(err instanceof Error ? err.message : String(err), 300), page).catch(() => undefined);
    } finally {
      clearTimeout(deadline);
    }
  }

  /** `null` = Schritt erfüllt, sonst die Fehlerbeschreibung. */
  private async runStep(page: Page, step: BrowserTestStep, allowed: Set<string>): Promise<string | null> {
    const timeout = step.timeoutMs;
    try {
      switch (step.type) {
        case "goto": {
          const verdict = resolveTarget(step.url, allowed);
          if (!verdict.ok) return verdict.reason;
          await page.goto(verdict.url, { timeout, waitUntil: "domcontentloaded" });
          return null;
        }
        case "click": await page.locator(step.selector).first().click({ timeout }); return null;
        case "fill": await page.locator(step.selector).first().fill(step.value, { timeout }); return null;
        case "expectVisible": await page.locator(step.selector).first().waitFor({ state: "visible", timeout }); return null;
        case "expectText": {
          const found = await page.locator(step.selector).filter({ hasText: step.text }).first().waitFor({ state: "visible", timeout }).then(() => true, () => false);
          if (found) return null;
          const actual = await page.locator(step.selector).first().innerText({ timeout: 500 }).catch(() => null);
          return `Text „${step.text}“ nicht gefunden in ${step.selector}${actual !== null ? ` (aktuell: „${clip(actual.replace(/\s+/g, " "), 80)}“)` : " (Element fehlt)"}`;
        }
        case "expectUrl": {
          const start = Date.now();
          while (Date.now() - start < timeout) {
            if (page.url().includes(step.contains)) return null;
            await page.waitForTimeout(100);
          }
          return `URL enthält „${step.contains}“ nicht (aktuell: ${page.url()})`;
        }
      }
    } catch (err) {
      return clip(err instanceof Error ? err.message.split("\n")[0]! : String(err), 300);
    }
  }
}
