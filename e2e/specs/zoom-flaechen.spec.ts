import type { Page } from "@playwright/test";
import { test, expect, openFromOverview, openLayer } from "../support/fixtures.ts";

/**
 * EPIC-P50: bei jedem UI-Zoom (EPIC-P20) füllen Flächen das Fenster exakt und das Fenster scrollt nie.
 * Unter `html { zoom }` sind dvh/vh/vw Layout-Pixel und müssen durch `--ui-zoom` geteilt werden
 * (docs/zoom-robuste-flaechen.md). Toleranz ±1 px (Rundung).
 */
async function zoomed(page: Page, scale: number): Promise<void> {
  await page.addInitScript((value) => localStorage.setItem("ancientvoid.uiScale", value), String(scale));
}

interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Sichtbare Rechtecke (Viewport-Pixel) der gefragten Elemente plus Fenstermaße. */
function geometry(page: Page, selectors: Record<string, string>) {
  return page.evaluate((sel) => {
    const boxes: Record<string, Box | null> = {};
    for (const [name, css] of Object.entries(sel)) {
      const el = document.querySelector(css);
      const r = el?.getBoundingClientRect();
      boxes[name] = r ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right } : null;
    }
    return { boxes, width: window.innerWidth, height: window.innerHeight };
  }, selectors);
}

function inside(box: Box | null, win: { width: number; height: number }): string[] {
  if (!box) return ["fehlt"];
  const out: string[] = [];
  if (box.top < -1) out.push(`oben ${Math.round(box.top)}px außerhalb`);
  if (box.left < -1) out.push(`links ${Math.round(box.left)}px außerhalb`);
  if (box.bottom > win.height + 1) out.push(`unten ${Math.round(box.bottom - win.height)}px außerhalb`);
  if (box.right > win.width + 1) out.push(`rechts ${Math.round(box.right - win.width)}px außerhalb`);
  return out;
}

test.describe("Zoom-robuste Flächen (EPIC-P50)", () => {
  test("BUG-0113: Dateien-Schublade bleibt bei UI-Zoom 130 % im Fenster, Kopf erreichbar", async ({ app, hub }) => {
    await zoomed(app, 1.3);
    await hub.createSession({ adapter: "dummy" });
    await app.goto(hub.origin);
    await openFromOverview(app, "dummy");
    await openLayer(app, "Dateibaum");
    await expect(app.locator(".files-sidebar.drawer")).toBeVisible();

    const g = await geometry(app, { drawer: ".files-sidebar.drawer", head: ".files-sidebar.drawer .files-head" });
    expect(inside(g.boxes.drawer, g), "Schublade").toEqual([]);
    expect(inside(g.boxes.head, g), "Schubladen-Kopf").toEqual([]);
    expect(Math.abs(g.boxes.drawer!.bottom - g.height)).toBeLessThanOrEqual(1);
  });

  test("BUG-0113: Browser-Panel bleibt bei UI-Zoom 130 % im Fenster", async ({ app, hub }) => {
    await zoomed(app, 1.3);
    await hub.createSession({ adapter: "dummy" });
    await app.goto(hub.origin);
    await openFromOverview(app, "dummy");
    await openLayer(app, "Browser");
    await expect(app.getByTestId("browser-panel")).toBeVisible();

    const g = await geometry(app, { panel: ".browser-panel" });
    expect(inside(g.boxes.panel, g), "Browser-Panel").toEqual([]);
  });

  test("Session mobil: das Fenster scrollt nie — auch nicht, wenn die Messung zu hoch läge (Garantie vor Messung)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy", prompt: "Hallo" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".tail-scroll").first()).toBeVisible();
    // Simulierter Messfehler: ein Block über der Liste macht die Seite weit höher als das Fenster.
    await app.evaluate(() => {
      const filler = document.createElement("div");
      filler.style.height = "3000px";
      document.querySelector(".session-live")!.prepend(filler);
    });
    await app.mouse.move(100, 200);
    await app.mouse.wheel(0, 2000);
    await app.waitForTimeout(150);
    const html = await app.evaluate(() => ({ overflow: getComputedStyle(document.documentElement).overflowY, scrollY: window.scrollY }));
    expect(html.scrollY, "html/body dürfen auf der Session-Route nie scrollen").toBe(0);
    expect(html.overflow).toBe("hidden");
  });
});
