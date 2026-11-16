import type { Page } from "@playwright/test";
import { test, expect, sessionTab } from "../support/fixtures.ts";

/**
 * BUG-0043 / BUG-0044: der Verlauf springt nicht, wenn man oben liest, und die
 * letzte Nachricht liegt nie unter dem fixierten Dock.
 */
test.describe("Verlauf scrollt und liegt über dem Dock", () => {
  test.use({ hubOptions: { dummyAutoStop: 400 } });

  async function openVerlauf(app: Page, origin: string, id: string) {
    await app.goto(`${origin}/#/sessions/${id}`);
    await sessionTab(app, "Verlauf");
    await app.getByRole("button", { name: "Debuggen" }).click();
  }
  const count = (app: Page) => app.locator(".event[data-seq]").count();

  test("BUG-0043: wer oben liest, wird von neuen Events nicht nach unten gerissen", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await openVerlauf(app, hub.origin, id);
    await expect.poll(() => count(app)).toBeGreaterThan(30);
    await app.locator(".tail-scroll").hover();
    await app.mouse.wheel(0, -100_000); // der Nutzer liest weiter oben
    await expect.poll(() => app.locator(".tail-scroll").evaluate((el) => Math.round(el.scrollTop))).toBeLessThan(120);
    const before = await count(app);
    await expect.poll(() => count(app)).toBeGreaterThan(before + 15);
    expect(await app.locator(".tail-scroll").evaluate((el) => Math.round(el.scrollTop))).toBeLessThan(260); // nicht nach unten gesprungen
  });

  test("BUG-0043: nach oben drehen löst die Leseposition schon vor der Scroll-Meldung @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await openVerlauf(app, hub.origin, id);
    await expect.poll(() => count(app)).toBeGreaterThan(30);
    // Fault injection: the wheel arrives, while scroll notifications are delayed.
    await app.locator(".tail-scroll").evaluate(el => {
      el.setAttribute("data-delay-scroll", "yes");
      el.addEventListener("scroll", event => {
        if (el.hasAttribute("data-delay-scroll")) event.stopImmediatePropagation();
      }, { capture: true });
    });
    try {
      await app.locator(".tail-scroll").hover();
      await app.mouse.wheel(0, -100_000);
      const before = await count(app);
      await expect.poll(() => count(app)).toBeGreaterThan(before + 15);
      expect(await app.locator(".tail-scroll").evaluate(el => Math.round(el.scrollTop))).toBeLessThan(260);
    } finally {
      await app.locator(".tail-scroll").evaluate(el => el.removeAttribute("data-delay-scroll"));
    }
  });

  test("BUG-0043: wer unten ist, bleibt unten, solange neue Events kommen", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await openVerlauf(app, hub.origin, id);
    await expect.poll(() => count(app)).toBeGreaterThan(30);
    const before = await count(app);
    await expect.poll(() => count(app)).toBeGreaterThan(before + 15);
    await expect
      .poll(() => app.locator(".tail-scroll").evaluate((el) => Math.round(el.scrollHeight - el.clientHeight - el.scrollTop)))
      .toBeLessThan(8);
  });

  const overlap = (app: Page) =>
    app.evaluate(() => {
      const tail = document.querySelector(".tail-scroll") as HTMLElement;
      const dock = document.querySelector(".dock-stack") as HTMLElement;
      const events = tail.querySelectorAll(".event");
      const last = events[events.length - 1] as HTMLElement;
      const dockTop = dock.getBoundingClientRect().top;
      return {
        last: Math.round(last.getBoundingClientRect().bottom - dockTop), // >0: letzte Nachricht unter dem Dock
        list: Math.round(tail.getBoundingClientRect().bottom - dockTop), // >0: Liste ragt unter das Dock
      };
    });

  test("BUG-0044: die letzte Nachricht liegt nach dem Öffnen und nach jedem Ein-/Ausblenden der Steuerung über dem Dock", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy", prompt: "Hallo" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.summary === "dummy: auto-stop reached"), "done", 40_000);
    await openVerlauf(app, hub.origin, id);
    await expect(app.getByText("dummy: auto-stop reached")).toBeVisible();
    const check = async (label: string) => {
      await expect.poll(async () => (await overlap(app)).list, { message: `${label}: Liste unter Dock` }).toBeLessThanOrEqual(1);
      await expect.poll(async () => (await overlap(app)).last, { message: `${label}: letzte Nachricht unter Dock` }).toBeLessThanOrEqual(1);
    };
    await check("offen");
    await app.getByLabel("Steuerung ausblenden").click();
    await check("minimiert");
    await app.getByLabel("Steuerung einblenden").click();
    await check("wieder offen");
  });

  test("BUG-0097: mit UI-Zoom scrollt nur der Chat — die Seite nicht, die Liste bleibt über dem Dock", async ({ app, hub }) => {
    // Der Nutzerzoom (EPIC-P20 T20.2) steht vor dem App-Boot: applyScale()
    // liest ihn beim Laden. Unter html-zoom misst die Tail-Höhenmessung
    // visuelle Pixel und setzte die Höhe in Layout-Pixeln — der Chat wurde
    // um den Zoomfaktor zu hoch, lief unter den Dock und schob die Seite.
    await app.addInitScript(() => localStorage.setItem("ancientvoid.uiScale", "1.3"));
    const id = await hub.createSession({ adapter: "dummy", prompt: "Hallo" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.summary === "dummy: auto-stop reached"), "done", 40_000);
    // Erst ein echter Reload bootet die App mit dem Zoom (applyScale liest
    // ihn beim Laden; ein Hash-Wechsel allein lädt nicht neu).
    await app.goto(`${hub.origin}/#/`);
    await app.reload();
    await openVerlauf(app, hub.origin, id);
    await expect(app.getByText("dummy: auto-stop reached")).toBeVisible();
    // Der Chat selbst muss scrollen (Inhalt > Fläche), sonst prüft der Test
    // gegen eine leere Fläche.
    await expect.poll(async () => app.locator(".tail-scroll").evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(60);
    const { list, pageScrollable } = await app.evaluate(() => {
      const se = document.scrollingElement!;
      const tail = document.querySelector(".tail-scroll") as HTMLElement;
      const dock = document.querySelector(".dock-stack") as HTMLElement;
      return {
        list: Math.round(tail.getBoundingClientRect().bottom - dock.getBoundingClientRect().top),
        pageScrollable: se.scrollHeight > se.clientHeight + 1,
      };
    });
    expect(pageScrollable, "die Sessionseite selbst darf nicht scrollen").toBe(false);
    expect(list, "Liste ragt unter den Dock").toBeLessThanOrEqual(1);
  });
});
