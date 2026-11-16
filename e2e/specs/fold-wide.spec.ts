import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures.ts";

/**
 * BUG-0180: Galaxy Z Fold 7 ausgeklappt — das innere Display ist hoch und rund
 * 832 CSS-px breit. Die App hielt trotzdem an einer 680-px-Spalte fest: links und
 * rechts schwarze Balken, die Sitzungsliste als quer scrollbarer Streifen über der
 * Session. Ausgeklappt soll die Breite benutzt werden: Liste links, Session rechts,
 * nichts überragt den Rand. Am Handy (412 px) bleibt alles wie bisher.
 */
const FOLD = { width: 832, height: 1088 };
const PHONE = { width: 412, height: 915 };

/** Bedienelemente, die über den Rand hinausragen oder auserhalb des Viewports liegen. */
function overflowing(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const sel = ".session-topbar button, .composer button, .strip-item, .dock button, .files-tabs button";
    return [...document.querySelectorAll(sel)]
      .map((el) => {
        const r = el.getBoundingClientRect();
        return r.width === 0 ? null : r.right > vw + 1 || r.left < -1 ? `${el.tagName.toLowerCase()} ${Math.round(r.left)}..${Math.round(r.right)}` : null;
      })
      .filter((x): x is string => x !== null);
  });
}

test.describe("Z Fold ausgeklappt (BUG-0180)", () => {
  test("Liste links, Session rechts — die Breite wird benutzt", async ({ app, hub }) => {
    await hub.createSession({ adapter: "dummy" }); // eine zweite Session — die Liste soll zeigen, was sie hat
    const id = await hub.createSession({ adapter: "dummy" });
    await app.setViewportSize(FOLD);
    await app.goto(`${hub.origin}/#/sessions/${id}`);

    const split = app.locator(".tablet-split");
    await expect(split).toBeVisible();
    const cols = await split.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").map(parseFloat));
    expect(cols).toHaveLength(2);
    expect(cols[0]!).toBeGreaterThanOrEqual(200);

    const box = await app.evaluate(() => {
      const strip = document.querySelector(".session-strip")!.getBoundingClientRect();
      const detail = document.querySelector(".tablet-detail")!.getBoundingClientRect();
      const appEl = document.getElementById("app")!.getBoundingClientRect();
      return {
        stripRight: strip.right,
        detailLeft: detail.left,
        stripBelow: strip.top >= 0 && strip.top < detail.bottom,
        appWidth: appEl.width,
        vw: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    // Die Liste steht links neben der Session, nicht darueber.
    expect(box.stripRight).toBeLessThanOrEqual(box.detailLeft + 1);
    // Keine zwei schwarzen Balken: die App fuellt den Screen bis auf ihr Randpadding.
    expect(box.appWidth).toBeGreaterThanOrEqual(box.vw - 28);
    expect(box.scrollWidth).toBeLessThanOrEqual(box.vw);
    expect(await overflowing(app)).toEqual([]);

    // Und die Liste ist wirklich erreichbar: die offene Session ist markiert, die
    // neue Session hat einen eigenen Knopf.
    await expect(app.locator(".strip-item")).toHaveCount(3); // zwei Sessions + „Neu“
    await expect(app.locator(".strip-item.active")).toHaveCount(1);
    await expect(app.locator(".strip-new")).toBeVisible();
  });

  test("am Handy bleibt es eine Spalte — und nichts ragt heraus", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await app.setViewportSize(PHONE);
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".tablet-split")).toHaveCount(0);
    await expect(app.locator(".session-topbar")).toBeVisible();
    expect(await overflowing(app)).toEqual([]);
  });
});
