import type { Page } from "@playwright/test";
import { test, expect, openFromOverview, openLayer } from "../support/fixtures.ts";
import type { TestHub } from "../support/hub.ts";

/**
 * EPIC-P50: bei jedem UI-Zoom (EPIC-P20, 70–200 %) und jeder Schriftgröße (EPIC-P34, 85–130 %) füllen Flächen das
 * Fenster exakt und das Fenster scrollt nie — nur Listen, Chat und Einzelkomponenten scrollen intern. Unter
 * `html { zoom }` sind dvh/vh/vw Layout-Pixel und müssen durch `--ui-zoom` geteilt werden (docs/zoom-robuste-flaechen.md).
 * Jede neue fensterfüllende Fläche gehört in diese Matrix. Toleranz ±1 px (Rundung); kein Retry, kein Skip.
 */
const UI_SCALES = [0.7, 1, 1.3, 2];
/** Schriftgröße: nur an den Rändern und bei 100 % — mit allen vier Zoomstufen gekreuzt. */
const FONT_SCALES = [0.85, 1, 1.3];

/** Zoom und Schrift vor dem Boot setzen: applyScale/applyAppearance lesen sie beim Laden. */
async function setScales(page: Page, ui: number, font: number): Promise<void> {
  await page.evaluate(
    ([u, f]) => {
      if (u === 1) localStorage.removeItem("ancientvoid.uiScale");
      else localStorage.setItem("ancientvoid.uiScale", String(u));
      if (f === 1) localStorage.removeItem("ancientvoid.appearance");
      else localStorage.setItem("ancientvoid.appearance", JSON.stringify({ accent: { dark: null, light: null }, fontUi: "inter", fontCode: "jetbrains-mono", fontScale: f }));
    },
    [ui, font] as const,
  );
}

interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Messung einer Fläche: Seiten-Überlauf und die Rechtecke (Viewport-Pixel) der benannten Elemente. */
function measure(page: Page, selectors: Record<string, string>) {
  return page.evaluate((sel) => {
    const se = document.scrollingElement!;
    const boxes: Record<string, Box | null> = {};
    for (const [name, css] of Object.entries(sel)) {
      const r = document.querySelector(css)?.getBoundingClientRect();
      boxes[name] = r ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right } : null;
    }
    const bar = document.querySelector(".status-bar")?.getBoundingClientRect();
    boxes.statusbar = bar ? { top: bar.top, bottom: bar.bottom, left: bar.left, right: bar.right } : null;
    return { overflowY: se.scrollHeight - se.clientHeight, boxes, width: window.innerWidth, height: window.innerHeight };
  }, selectors);
}
type Measured = Awaited<ReturnType<typeof measure>>;

/** Befunde je Stufe: Seite scrollt, Fläche fehlt oder ragt über den Rand. */
function pageFits(m: Measured, label: string): string[] {
  return m.overflowY > 1 ? [`${label}: Seite scrollt um ${m.overflowY}px`] : [];
}
function inside(m: Measured, name: string, label: string): string[] {
  const b = m.boxes[name];
  if (!b) return [`${label}: ${name} fehlt`];
  const out: string[] = [];
  if (b.top < -1) out.push(`${label}: ${name} oben ${Math.round(b.top)}px außerhalb`);
  if (b.left < -1) out.push(`${label}: ${name} links ${Math.round(b.left)}px außerhalb`);
  if (b.bottom > m.height + 1) out.push(`${label}: ${name} unten ${Math.round(b.bottom - m.height)}px außerhalb`);
  if (b.right > m.width + 1) out.push(`${label}: ${name} rechts ${Math.round(b.right - m.width)}px außerhalb`);
  return out;
}
/**
 * Die Unterkante liegt bei `window.innerHeight` ± 1 px — am PC (ab 1280 px) endet die Fläche über der Statusleiste
 * (28 Layout-Pixel, 21-icon-rail.css), deren Oberkante dann der Boden ist.
 */
function fillsBottom(m: Measured, name: string, label: string): string[] {
  const b = m.boxes[name];
  if (!b) return [`${label}: ${name} fehlt`];
  const bar = m.boxes.statusbar;
  const floor = bar && bar.bottom - bar.top > 0 ? bar.top : m.height;
  return Math.abs(b.bottom - floor) > 1 ? [`${label}: ${name}-Unterkante ${Math.round(b.bottom)} ≠ Boden ${Math.round(floor)}`] : [];
}

/** Alle Stufen auf derselben Seite durchfahren (Reload je Stufe); `check` sammelt Befunde. */
async function sweep(page: Page, reopen: () => Promise<void>, check: (label: string) => Promise<string[]>): Promise<string[]> {
  const found: string[] = [];
  for (const ui of UI_SCALES) {
    for (const font of FONT_SCALES) {
      await setScales(page, ui, font);
      await page.reload();
      await reopen();
      found.push(...(await check(`zoom ${Math.round(ui * 100)} % / Schrift ${Math.round(font * 100)} %`)));
    }
  }
  return found;
}

async function sessionWithEvents(hub: TestHub): Promise<string> {
  const id = await hub.createSession({ adapter: "dummy", prompt: "Hallo" });
  await hub.until(async () => (await hub.events(id)).some((e) => e.summary === "dummy: auto-stop reached"), "done", 40_000);
  return id;
}

test.describe("Zoom-robuste Flächen (EPIC-P50)", () => {
  test.use({ hubOptions: { dummyAutoStop: 400 } });
  // Die Matrix lädt je Stufe neu (4 Zoom × 3 Schrift) — mehr Zeit als die 45 s eines Einzelfalls.
  test.beforeEach(() => test.setTimeout(120_000));

  test("Übersicht: Fenster scrollt nie, die Shell füllt das Fenster @desktop", async ({ app, hub }) => {
    for (let i = 0; i < 12; i++) await hub.createSession({ adapter: "dummy", prompt: `Zoom ${i + 1}` });
    await app.goto(`${hub.origin}/#/`);
    const found = await sweep(
      app,
      () => expect(app.locator(".dashboard .session-card, .split-list .session-card").first()).toBeVisible(),
      async (label) => {
        const m = await measure(app, { shell: ".split, .app-page" });
        return [...pageFits(m, label), ...fillsBottom(m, "shell", label)];
      },
    );
    expect(found).toEqual([]);
  });

  test("Session mobil: nur der Chat scrollt, Dock liegt am Fensterboden", async ({ app, hub }) => {
    const id = await sessionWithEvents(hub);
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const found = await sweep(
      app,
      () => expect(app.locator(".tail-scroll").first()).toBeVisible(),
      async (label) => {
        const m = await measure(app, { dock: ".dock-stack" });
        return [...pageFits(m, label), ...fillsBottom(m, "dock", label)];
      },
    );
    expect(found).toEqual([]);
  });

  test("Session mobil: das Fenster scrollt nie — auch nicht, wenn die Messung zu hoch läge (Garantie vor Messung)", async ({ app, hub }) => {
    const id = await sessionWithEvents(hub);
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".tail-scroll").first()).toBeVisible();
    // Simulierter Messfehler: ein Block über der Liste macht die Seite weit höher als das Fenster.
    await app.evaluate(() => {
      const filler = document.createElement("div");
      filler.dataset.testid = "messfehler";
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

  test.describe("Desktop-Fläche", () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test("Session-Kachel am PC: Shell füllt das Fenster, Seite scrollt nie @desktop", async ({ app, hub }) => {
      const id = await sessionWithEvents(hub);
      await app.goto(`${hub.origin}/#/sessions/${id}`);
      const found = await sweep(
        app,
        () => expect(app.locator('[data-tile="1"] .session-topbar')).toBeVisible(),
        async (label) => {
          const m = await measure(app, { shell: ".split" });
          return [...pageFits(m, label), ...fillsBottom(m, "shell", label)];
        },
      );
      expect(found).toEqual([]);
    });

    test("Session-Popout: Fenster scrollt nie, Shell füllt das Fenster @desktop", async ({ app, hub, context }) => {
      await hub.createSession({ adapter: "dummy" });
      await app.locator(".split-list .session-card").first().locator(".session-open").click();
      await app.locator('[data-tile="1"] .session-topbar').waitFor();
      const popupP = context.waitForEvent("page");
      await app.locator(".tile-popout").first().click();
      const popup = await popupP;
      await popup.waitForLoadState();
      await expect(popup.locator(".session-topbar")).toBeVisible();
      const found = await sweep(
        popup,
        () => expect(popup.locator(".session-topbar")).toBeVisible(),
        async (label) => {
          const m = await measure(popup, { shell: ".popout-shell" });
          return [...pageFits(m, label), ...fillsBottom(m, "shell", label)];
        },
      );
      await popup.close();
      expect(found).toEqual([]);
    });
  });

  test("BUG-0113: Dateien-Schublade und ihr Kopf bleiben im Fenster, Seite scrollt nie", async ({ app, hub }) => {
    await hub.createSession({ adapter: "dummy" });
    await app.goto(hub.origin);
    await openFromOverview(app, "dummy");
    const found = await sweep(
      app,
      async () => {
        // Die Schublade merkt „offen“ über den Reload — dann nicht erneut öffnen.
        if ((await app.locator(".files-sidebar.drawer").count()) === 0) await openLayer(app, "Dateibaum");
        await expect(app.locator(".files-sidebar.drawer")).toBeVisible();
      },
      async (label) => {
        const m = await measure(app, { drawer: ".files-sidebar.drawer", head: ".files-sidebar.drawer .files-head" });
        return [...pageFits(m, label), ...inside(m, "drawer", label), ...inside(m, "head", label), ...fillsBottom(m, "drawer", label)];
      },
    );
    expect(found).toEqual([]);
  });

  test("BUG-0113: Browser-Panel bleibt im Fenster, Seite scrollt nie", async ({ app, hub }) => {
    await hub.createSession({ adapter: "dummy" });
    await app.goto(hub.origin);
    await openFromOverview(app, "dummy");
    const found = await sweep(
      app,
      async () => {
        if ((await app.getByTestId("browser-panel").count()) === 0) await openLayer(app, "Browser");
        await expect(app.getByTestId("browser-panel")).toBeVisible();
      },
      async (label) => {
        const m = await measure(app, { panel: ".browser-panel" });
        return [...pageFits(m, label), ...inside(m, "panel", label), ...fillsBottom(m, "panel", label)];
      },
    );
    expect(found).toEqual([]);
  });
});
