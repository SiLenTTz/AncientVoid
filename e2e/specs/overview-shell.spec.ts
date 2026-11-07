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

  test("BUG-0103: im Desktop-Layout scrollt nur die Session-Liste, nie horizontal @desktop", async ({ app, hub }) => {
    await app.setViewportSize({ width: 1440, height: 900 });
    for (let i = 0; i < 18; i++) {
      await hub.createSession({ adapter: "dummy", prompt: `Übersicht ${i + 1}` });
    }
    await app.goto(`${hub.origin}/#/`);
    await expect(app.locator(".split-list .dashboard .session-card")).toHaveCount(18);
    const m = await app.evaluate(() => {
      const scrolls = (el: Element) => {
        const o = getComputedStyle(el).overflowY;
        return (o === "auto" || o === "scroll") && el.scrollHeight > el.clientHeight + 1;
      };
      const col = document.querySelector(".split-list")!;
      const list = document.querySelector(".split-list .dashboard")!;
      return { colOverflow: getComputedStyle(col).overflowY, colScrolls: scrolls(col), listScrolls: scrolls(list), colX: col.scrollWidth > col.clientWidth + 1 };
    });
    expect(m.listScrolls, "die Session-Liste scrollt").toBe(true);
    expect(m.colOverflow, "die Spalte darum scrollt nicht zusätzlich").toBe("hidden");
    expect(m.colX, "nie horizontal").toBe(false);
  });

  test("BUG-0099-Nachtrag: bei wenigen Sessions zeigt die Liste keine Scrollbar", async ({ app, hub }) => {
    for (let i = 0; i < 4; i++) {
      await hub.createSession({ adapter: "dummy", prompt: `Wenige ${i + 1}` });
    }
    // Knappes Fenster (Zoom 1): Mit dem Dock-Padding INNERHALB der Liste
    // (alter Code, 86 px) erschien hier eine Scrollbar, obwohl alle Karten
    // sichtbar waren — scrollbarer Leerraum unter der letzten Karte.
    await app.setViewportSize({ width: 412, height: 710 });
    await app.goto(`${hub.origin}/#/`);
    await app.reload();
    await expect(app.locator(".dashboard .session-card").first()).toBeVisible();
    const m = await app.evaluate(() => {
      const se = document.scrollingElement!;
      const list = document.querySelector(".dashboard") as HTMLElement;
      return {
        pageScrollable: se.scrollHeight > se.clientHeight + 1,
        listScrollable: list.scrollHeight > list.clientHeight + 1,
      };
    });
    expect(m.pageScrollable, "das App-Fenster selbst darf nicht scrollen").toBe(false);
    expect(m.listScrollable, "4 Sessions brauchen keine Listen-Scrollbar").toBe(false);
    // BUG-0099-Nachtrag 2: Das Fenster ist auf der Übersicht prinzipbedingt
    // geklemmt — selbst ein Element über der Shell (z. B. Offline-Banner)
    // kann keinen Body-Scroll mehr erzeugen.
    expect(await app.evaluate(() => getComputedStyle(document.documentElement).overflow + "/" + getComputedStyle(document.body).overflow)).toBe("hidden/hidden");
  });
});
