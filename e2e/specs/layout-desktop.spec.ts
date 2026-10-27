import { test, expect } from "../support/fixtures.ts";

test.describe("Desktop (T8.5, AC-P8-6)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("ab 1280 px: Liste links, Session rechts — Wechsel ohne Seitenwechsel", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Erste Aufgabe" });
    await hub.createSession({ adapter: "opencode", project: hub.beta, prompt: "Zweite Aufgabe" });
    await expect(app.locator(".tile-empty")).toContainText("Session links wählen");
    await app.locator(".split-list .session-card").filter({ hasText: "Erste Aufgabe" }).locator(".session-open").click();
    await expect(app.locator(".split-detail .session-top-title")).toHaveText("Erste Aufgabe");
    await expect(app.locator(".split-list .session-card")).toHaveCount(2);
    await app.locator(".split-list .session-card").filter({ hasText: "Zweite Aufgabe" }).locator(".session-open").click();
    await expect(app.locator(".split-detail .session-top-title")).toHaveText("Zweite Aufgabe");
    const [list, detail] = await Promise.all([app.locator(".split-list").boundingBox(), app.locator(".split-detail").boundingBox()]);
    expect(list!.x + list!.width).toBeLessThanOrEqual(detail!.x);
    expect(detail!.width).toBeGreaterThan(600);
  });
});
