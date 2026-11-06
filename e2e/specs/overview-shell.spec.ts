import { test, expect } from "../support/fixtures.ts";

/**
 * BUG-0099: Als installierte App (Omarchy-Web-App / PWA-Fenster) scrollt
 * das Fenster nie — die Session-Liste der Übersicht scrollt zwischen
 * Topbar und Dock, wie der Chat in der Session.
 */
test.describe("Übersicht scrollt im Fenster-Layout", () => {
  test("BUG-0099: das Fenster scrollt nicht — die Session-Liste scrollt intern", async ({ app, hub }) => {
    for (let i = 0; i < 18; i++) {
      await hub.createSession({ adapter: "dummy", prompt: `Übersicht ${i + 1}` });
    }
    await app.goto(`${hub.origin}/#/`);
    await expect(app.locator(".dashboard .session-card").first()).toBeVisible();
    await expect(app.locator(".session-card")).not.toHaveCount(0);

    const m = await app.evaluate(() => {
      const se = document.scrollingElement!;
      const list = document.querySelector(".dashboard") as HTMLElement;
      const page = document.querySelector(".app-page") as HTMLElement;
      return {
        pageScrollable: se.scrollHeight > se.clientHeight + 1,
        listScrollable: list.scrollHeight > list.clientHeight + 1,
      };
    });
    expect(m.pageScrollable, "das App-Fenster selbst darf nicht scrollen").toBe(false);
    expect(m.listScrollable, "die Session-Liste muss intern scrollen").toBe(true);

    // Die letzte Karte bleibt erreichbar: Listen-Scroll statt Fenster-Scroll.
    await app.locator(".session-card").last().scrollIntoViewIfNeeded();
    await expect(app.locator(".session-card").last()).toBeVisible();
    expect(await app.evaluate(() => window.scrollY)).toBe(0);
  });
});
