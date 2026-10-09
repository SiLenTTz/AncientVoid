import { chromium, type Browser, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";

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

export interface PhoneTab {
  page: Page;
  close(): Promise<void>;
}

/** Open a fresh tab in Chrome on the phone and make the hub's port reachable from it. */
export async function openPhoneTab(hubPort: number): Promise<PhoneTab> {
  adb("reverse", `tcp:${hubPort}`, `tcp:${hubPort}`);
  let browser: Browser | undefined;
  try {
    browser = await chromium.connectOverCDP(phone.cdp, { timeout: 15_000 });
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = await context.newPage();
    // Playwright setzt neuen Tabs ein Desktop-Fenster (1280×720) auf; auf dem Handy soll das echte gelten.
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.clearDeviceMetricsOverride");
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
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
    throw new Error(`Handy nicht erreichbar (${phone.cdp}): ${err instanceof Error ? err.message : String(err)}`);
  }
}
