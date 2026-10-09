import { test as base, expect, type Page } from "@playwright/test";
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
    // Mit UACC_E2E_CDP (scripts/phone-e2e.mjs) ist der Browser das echte Handy statt des Playwright-Browsers.
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
    await expect(page.getByRole("heading", { name: "UACC", exact: true })).toBeVisible();
    await use(page);
  },
});

export async function signIn(page: Page, hub: TestHub): Promise<void> {
  await page.addInitScript((token) => {
    if (!localStorage.getItem("uacc.token")) localStorage.setItem("uacc.token", token);
  }, hub.token);
}

/** Opens a session through the overview, the way a user does. */
export async function openFromOverview(page: Page, adapter: string): Promise<void> {
  await page.getByRole("button", { name: "Übersicht" }).click();
  await page.locator(".session-card").filter({ hasText: adapter }).first().locator(".session-open").click();
}

export function statusPill(page: Page) {
  return page.locator(".topbar .pill");
}
