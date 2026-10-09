import { chromium, type Browser, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abortReason, quarterFromDumpsys } from "../../scripts/phone-run-guard.mjs";

const deadFlag = join(tmpdir(), "uacc-phone-cdp-dead");

/**
 * Das echte Handy als Browser der E2E-Specs. `scripts/phone-e2e.mjs` leitet Chromes DevTools-Socket
 * des Handys per `adb forward` auf den PC und setzt UACC_E2E_CDP und UACC_PHONE_SERIAL.
 *
 * Die Tests laufen gegen einen eigenen Test-Hub auf dem PC (nie gegen deinen Hub): sein Port wird per
 * `adb reverse` auf dem Handy als http://127.0.0.1:PORT erreichbar — derselbe Ursprung wie am PC und
 * ein sicherer Kontext (Mikrofon, Service Worker). Jeder Test öffnet einen eigenen Tab und schließt
 * ihn wieder; bestehende Tabs des Handys werden nicht angefasst.
 */
export const phone = {
  cdp: process.env.UACC_E2E_CDP ?? "",
  serial: process.env.UACC_PHONE_SERIAL ?? "",
  get active(): boolean {
    return this.cdp !== "";
  },
};

const adb = (...args: string[]): string => execFileSync("adb", phone.serial ? ["-s", phone.serial, ...args] : args, { encoding: "utf8", timeout: 20_000 });

/**
 * Offene Bildschirmtastatur: Chrome verschiebt dann die sichtbare Fläche (visualViewport.offsetTop ≈ 350 px),
 * und Playwrights Klickkoordinaten liegen daneben — gemessen am Pixel 9 Pro XL: dieselbe Taste trifft bei
 * geschlossener Tastatur, bei offener nicht. Ein Mensch schließt die Tastatur auch, bevor er einen Knopf antippt.
 * Die Zurück-Taste wird nur gesendet, wenn die Tastatur wirklich offen ist (sonst verließe sie die Seite).
 */
async function dismissKeyboard(page: Page): Promise<void> {
  const open = await page.evaluate("visualViewport !== null && visualViewport.height < innerHeight - 120").catch(() => false);
  if (!open) return;
  adb("shell", "input", "keyevent", "4");
  await page.waitForFunction("visualViewport.height >= innerHeight - 5", undefined, { timeout: 3000 }).catch(() => undefined);
}

let patched = false;
/** Mausartige Aktionen schließen vorher die Tastatur (siehe dismissKeyboard). Einmal je Prozess. */
function patchLocatorActions(page: Page): void {
  if (patched) return;
  const proto = Object.getPrototypeOf(page.locator("body")) as Record<string, (...args: unknown[]) => Promise<unknown>>;
  for (const name of ["click", "dblclick", "tap", "check", "uncheck", "setChecked", "hover"]) {
    const original = proto[name];
    if (typeof original !== "function") continue;
    proto[name] = async function (this: { page(): Page }, ...args: unknown[]) {
      await dismissKeyboard(this.page());
      return original.apply(this, args);
    };
  }
  patched = true;
}

export interface PhoneTab {
  page: Page;
  close(): Promise<void>;
}

/** Open a fresh tab in Chrome on the phone and make the hub's port reachable from it. */
function endPhoneRun(reason: string): never {
  writeFileSync(deadFlag, reason);
  console.error(reason);
  // The worker's parent is the Playwright runner. SIGINT ends the suite
  // instead of spending 15 s on every remaining test (BUG-0055).
  try {
    process.kill(process.ppid, "SIGINT");
  } catch {
    // already gone
  }
  throw new Error(reason);
}

export async function openPhoneTab(hubPort: number): Promise<PhoneTab> {
  if (existsSync(deadFlag)) endPhoneRun(readFileSync(deadFlag, "utf8").trim() || "Lauf abgebrochen.");
  const turned = abortReason({
    quarter: quarterFromDumpsys(adb("shell", "dumpsys", "window", "displays")),
    cdpDown: false,
    lockPortrait: process.env.UACC_PHONE_LOCK_PORTRAIT === "1",
  });
  if (turned) endPhoneRun(turned);

  adb("reverse", `tcp:${hubPort}`, `tcp:${hubPort}`);
  let browser: Browser | undefined;
  try {
    browser = await chromium.connectOverCDP(phone.cdp, { timeout: 15_000 });
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = await context.newPage();
    patchLocatorActions(page);
    // Ein neuer Tab öffnet im Hintergrund; dort drosselt Android Zeitgeber und Rendering (Zufallsfehler „Überschrift nicht gefunden“).
    await page.bringToFront();
    // Playwright setzt neuen Tabs ein Desktop-Fenster (1280×720) auf; auf dem Handy soll das echte gelten.
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.clearDeviceMetricsOverride");
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    // Wie `serviceWorkers: "block"` in den anderen Projekten: ein Service Worker würde nach einem Hub-Stopp den
    // letzten Stand liefern (K10) und Tests verfälschen, die genau den Ausfall prüfen.
    await cdp.send("Network.enable");
    await cdp.send("Network.setBypassServiceWorker", { bypass: true });
    return {
      page,
      close: async () => {
        await page.close().catch(() => undefined);
        await browser?.close().catch(() => undefined); // trennt nur, Chrome bleibt offen
        try {
          adb("reverse", "--remove", `tcp:${hubPort}`);
        } catch {
          // schon weg
        }
      },
    };
  } catch (err) {
    await browser?.close().catch(() => undefined);
    const message = err instanceof Error ? err.message : String(err);
    if (/Timeout|ECONNREFUSED|connectOverCDP|websocket/i.test(message)) {
      endPhoneRun(abortReason({ quarter: null, cdpDown: true, lockPortrait: false }) ?? message);
    }
    throw new Error(`Handy nicht erreichbar (${phone.cdp}): ${message}`, { cause: err });
  }
}
