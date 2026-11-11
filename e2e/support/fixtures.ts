import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { TestHub, type HubOptions } from "./hub.ts";
import { openPhoneTab, phone } from "./phone.ts";

export { expect };

interface Fixtures {
  hubOptions: HubOptions;
  hub: TestHub;
  /** A page that already holds the device token and shows the overview. */
  app: Page;
}

export const test = base.extend<Fixtures>({
  hubOptions: [{}, { option: true }],

  hub: async ({ hubOptions }, use, testInfo) => {
    const hub = await TestHub.start(hubOptions);
    try {
      await use(hub);
    } finally {
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach("hub.log", { body: readFileSync(hub.logPath), contentType: "text/plain" }).catch(() => undefined);
      }
      await hub.stop();
    }
  },

  // Every test fails on an uncaught exception in the PWA — a crash that
  // happens to leave the asserted text on screen is still a crash.
  page: async ({ page, hub }, use) => {
    // Mit ANCIENTVOID_E2E_CDP (scripts/phone-e2e.mjs) ist der Browser das echte Handy statt des Playwright-Browsers.
    const tab = phone.active ? await openPhoneTab(hub.port) : null;
    const target = tab ? tab.page : page;
    const errors: string[] = [];
    target.on("pageerror", (err) => errors.push(err.message));
    try {
      await use(target);
      expect(errors, "uncaught PWA exceptions").toEqual([]);
    } finally {
      await tab?.close();
    }
  },

  app: async ({ page, hub }, use) => {
    await signIn(page, hub);
    await page.goto(hub.origin);
    await expect(page.getByRole("heading", { name: "AncientVoid", exact: true })).toBeVisible();
    await use(page);
  },
});

export async function signIn(page: Page, hub: TestHub): Promise<void> {
  // Always replace. On the phone, Chrome keeps localStorage per 127.0.0.1 port.
  // A recycled port still holds the previous hub's token, and the gate then
  // stays up with that token filled (BUG-0054).
  // Top frame only: this init script runs in EVERY frame — a sandboxed
  // preview iframe (EPIC-P29, opaque origin) would throw on localStorage
  // and surface as an uncaught page error that belongs to nobody.
  await page.addInitScript((token) => {
    if (window.top === window) localStorage.setItem("ancientvoid.token", token);
  }, hub.token);
}

/** Opens a session through the overview, the way a user does. */
export async function openFromOverview(page: Page, adapter: string): Promise<void> {
  await page.locator(".dock").getByRole("button", { name: "Start", exact: true }).click();
  await page.locator(".session-card").filter({ hasText: adapter }).first().locator(".session-open").click();
}

export function statusPill(page: Page) {
  return page.locator(".topbar .status");
}

/**
 * EPIC-P43 T43.3: ein Ziel der globalen Navigation öffnen. Am PC steht jedes Ziel in der Leiste,
 * am Handy und Tablet liegen Entdeckt, Medien, Notizen, Automationen und Einstellungen unter „Mehr“.
 */
export async function dockGo(page: Page, name: string): Promise<void> {
  const dock = page.locator(".dock");
  const target = dock.getByRole("button", { name, exact: true });
  if (await target.isVisible()) return target.click();
  await dock.getByRole("button", { name: "Mehr", exact: true }).click();
  await page.getByRole("dialog", { name: "Mehr" }).getByRole("button", { name, exact: true }).click();
}

/**
 * EPIC-P43 T43.3: die Freigabe-Warteschlange von Start aus öffnen — über „n Freigaben · alle zeigen“
 * bei „Du bist dran“, oder über das Banner, wenn die Freigabe an keiner Karte hängt.
 */
export async function openApprovals(page: Page): Promise<void> {
  await page.locator(".approval-link, .approval-banner").first().click();
}

/** EPIC-P43 T43.3: „Ruhig“ ist zu, solange oben etwas steht — für Tests, die eine ruhige Session brauchen. */
export async function openQuiet(page: Page): Promise<void> {
  const fold = page.locator(".section-zuletzt .section-fold");
  await fold.waitFor();
  if ((await fold.getAttribute("aria-expanded")) === "false") await fold.click();
}

/**
 * EPIC-P43 T43.4: eine Ansicht der Session öffnen. Chat, Änderungen (früher „Diff“) und Dateien (früher
 * „Code“) sind Reiter; Verlauf, Bericht, Datei, Graph, GitLab, Suche und Umgebung liegen unter „Mehr“.
 */
export async function sessionTab(scope: Page | Locator, name: string): Promise<void> {
  const bar = scope.locator(".subtabs-wrap").first();
  const main = ({ Diff: "Änderungen", Code: "Dateien" } as Record<string, string>)[name] ?? name;
  if (["Chat", "Änderungen", "Dateien"].includes(main)) return bar.getByRole("button", { name: new RegExp(`^${main}`) }).click();
  const menu = bar.getByRole("menu", { name: "Weitere Ansichten" });
  if (!(await menu.isVisible())) await bar.locator('[aria-haspopup="menu"]').click();
  await menu.getByRole("menuitem", { name: main, exact: true }).click();
}
