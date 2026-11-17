import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures.ts";

/**
 * BUG-0045: ein einzelner fehlgeschlagener Abruf darf die Oberfläche nicht
 * umbauen (Fehlerkarte oben ein- und ausblenden, Banner verschwinden lassen).
 */
test.describe("Kurze Abruffehler lassen die Oberfläche in Ruhe", () => {
  // Browser-Code als String: das e2e-tsconfig hat keine DOM-Typen.
  const watch = (selector: string) => `
    (() => {
      const w = window;
      w.__seen = { appeared: 0, vanished: 0, present: false };
      const update = () => {
        const now = !!document.querySelector(${JSON.stringify(selector)});
        if (now && !w.__seen.present) w.__seen.appeared += 1;
        if (!now && w.__seen.present) w.__seen.vanished += 1;
        w.__seen.present = now;
      };
      new MutationObserver(update).observe(document.body, { childList: true, subtree: true });
      update();
    })()
  `;
  const seen = (app: Page) =>
    app.evaluate(`window.__seen`) as Promise<{ appeared: number; vanished: number; present: boolean }>;

  test("BUG-0045: jeder zweite Abruf schlägt fehl — keine Fehlerkarte erscheint", async ({ app }) => {
    let calls = 0;
    await app.route("**/api/adapters", (route) => (calls++ % 2 === 0 ? route.abort() : route.continue()));
    await app.evaluate(watch("[data-testid=load-error]"));
    await app.reload();
    await app.evaluate(watch("[data-testid=load-error]"));
    await expect.poll(() => calls, { timeout: 30_000 }).toBeGreaterThanOrEqual(6);
    expect((await seen(app)).appeared).toBe(0);
  });

  test("BUG-0045: schlägt der Abruf der Freigaben einmal fehl, bleibt das Banner stehen", async ({ app }) => {
    let calls = 0;
    const pending = [{ id: "a1", sessionId: "s1", class: "write", action: "x", summary: "x", status: "pending", createdAt: new Date().toISOString(), timeoutAt: new Date(Date.now() + 600_000).toISOString(), reasonRequired: false }];
    await app.route(/\/api\/approvals\?status=pending/, (route) => {
      const n = calls++;
      if (n === 0 || n % 2 === 0) return route.fulfill({ json: pending });
      return route.abort();
    });
    await app.reload();
    await expect(app.locator(".approval-banner")).toBeVisible();
    await app.evaluate(watch(".approval-banner"));
    await expect.poll(() => calls, { timeout: 30_000 }).toBeGreaterThanOrEqual(7);
    const s = await seen(app);
    expect(s.vanished).toBe(0);
    expect(s.present).toBe(true);
  });
});
