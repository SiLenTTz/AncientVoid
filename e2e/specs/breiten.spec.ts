import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures.ts";

/**
 * EPIC-P43 AC-P43-6: kein horizontales Scrollen und keine abgeschnittene Bedienung in den vier Breiten — je Ansicht
 * (Start mit Freigabe, Session, Nyx-Blatt). Auf Touch sind Bedienziele mindestens 44 px hoch, mit Maus 30 px.
 */
const WIDTHS = [
  { w: 412, h: 915 },
  { w: 800, h: 1280 },
  { w: 1280, h: 800 },
  { w: 1600, h: 1000 },
];

/** Sichtbare Bedienelemente, die den Rand überragen oder kleiner als `min` sind. */
function problems(page: Page, min: number): Promise<{ overflow: number; cut: string[]; small: string[] }> {
  return page.evaluate((min) => {
    const vw = window.innerWidth;
    const label = (el: Element) => `${el.tagName.toLowerCase()}.${[...el.classList].join(".")} „${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}“`;
    const controls = [...document.querySelectorAll(".topbar button, .dock button, .card-decision button, .nyx-sheet button, .session-topbar button, .composer button")].filter((el) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== "hidden";
    });
    return {
      overflow: document.documentElement.scrollWidth - vw,
      cut: controls.filter((el) => { const r = el.getBoundingClientRect(); return r.left < -1 || r.right > vw + 1; }).map(label),
      small: controls.filter((el) => el.getBoundingClientRect().height < min - 0.5).map(label),
    };
  }, min);
}

test.describe("Vier Breiten (EPIC-P43 AC-P43-6)", () => {
  test("Start, Session und Nyx-Blatt: nichts ragt heraus, Ziele groß genug @tablet @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "Bitte WERKZEUG ausführen" });
    await hub.until(async () => (await hub.api<{ sessionId: string }[]>("/api/approvals?status=pending")).body.some((a) => a.sessionId === id), "Freigabe");
    const touch = await app.evaluate(() => matchMedia("(pointer: coarse)").matches);
    const found: string[] = [];
    for (const { w, h } of WIDTHS) {
      // Ab 1280 px ist es die PC-Arbeitsfläche (Maus), darunter Handy/Tablet (Touch).
      const min = touch && w < 1280 ? 44 : 30;
      await app.setViewportSize({ width: w, height: h });
      await app.goto(hub.origin);
      await expect(app.locator(".card-decision").first()).toBeVisible();
      const start = await problems(app, min);
      await app.locator(".topbar .nyx-button").click();
      await expect(app.getByRole("dialog", { name: "Nyx" })).toBeVisible();
      const nyx = await problems(app, min);
      await app.keyboard.press("Escape");
      await app.goto(`${hub.origin}/#/sessions/${id}`);
      await expect(app.locator(".session-top-title").first()).toBeVisible();
      const session = await problems(app, min);
      for (const [view, p] of [["Start", start], ["Nyx", nyx], ["Session", session]] as const) {
        if (p.overflow > 0) found.push(`${w}px ${view}: ${p.overflow}px horizontal`);
        for (const c of p.cut) found.push(`${w}px ${view}: abgeschnitten ${c}`);
        for (const c of p.small) found.push(`${w}px ${view}: < ${min}px ${c}`);
      }
    }
    expect(found).toEqual([]);
  });
});
