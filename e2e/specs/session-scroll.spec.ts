import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures.ts";

/**
 * BUG-0043 / BUG-0044: der Verlauf springt nicht, wenn man oben liest, und die
 * letzte Nachricht liegt nie unter dem fixierten Dock.
 */
test.describe("Verlauf scrollt und liegt über dem Dock", () => {
  test.use({ hubOptions: { dummyAutoStop: 400 } });

  async function openVerlauf(app: Page, origin: string, id: string) {
    await app.goto(`${origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Verlauf" }).click();
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
});
