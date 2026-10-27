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

  test("Icon-Leisten, klickbare Kürzel und kein Fenster-Scroll (P21)", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Erste Aufgabe" });
    await hub.createSession({ adapter: "opencode", project: hub.beta, prompt: "Zweite Aufgabe" });
    await app.locator(".split-list .session-card").filter({ hasText: "Erste Aufgabe" }).locator(".session-open").click();
    await expect(app.locator(".split-detail .session-top-title")).toHaveText("Erste Aufgabe");

    // Das Fenster selbst scrollt nie.
    const overflow = await app.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    expect(overflow).toBeLessThanOrEqual(0);

    // Globale Navigation: schmale Leiste am linken Rand, Beschriftung nur als Tooltip/Name.
    const rail = await app.locator(".split-list .dock-stack").boundingBox();
    expect(rail!.width).toBeLessThanOrEqual(64);
    await expect(app.locator(".split-list .dock-item").last()).toHaveAttribute("title", "Einstellungen");

    // Kachel-Ansichten: senkrechte Leiste links neben dem Inhalt.
    const tabs = app.locator(".tile-rail");
    await expect(tabs.getByRole("button")).toHaveCount(6);
    const [tabBox, mainBox] = await Promise.all([tabs.boundingBox(), app.locator(".tile .session-main").boundingBox()]);
    expect(tabBox!.x + tabBox!.width).toBeLessThanOrEqual(mainBox!.x);
    await tabs.getByRole("button", { name: "Bericht" }).click();
    await expect(tabs.getByRole("button", { name: "Bericht" })).toHaveAttribute("aria-current", "page");

    // Kürzel als Knöpfe: Layout wechseln und eine zweite Kachel leeren.
    await app.getByRole("group", { name: "Kachel-Aktionen" }).getByRole("button", { name: /Layout/ }).click();
    await expect(app.locator(".tile")).not.toHaveCount(1);
    const tiles = await app.locator(".tile").count();
    await app.getByRole("button", { name: /Leeren/ }).click();
    await expect(app.locator(".tile")).toHaveCount(tiles);
  });
});
