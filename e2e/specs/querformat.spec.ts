import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures.ts";

/**
 * BUG-0053: im Querformat (niedriges Fenster) füllte das Dock fast den ganzen Bildschirm; vom Verlauf
 * blieben ~120 von 368 px. Gemessen am echten Pixel 9 Pro XL: Dock 327 px, Verlauf 120 px.
 */
test.describe("Dock im Querformat", () => {
  const LANDSCAPE = { width: 900, height: 420 };

  const geometry = (app: Page) =>
    app.evaluate(`(() => {
      const box = (el) => (el ? el.getBoundingClientRect() : null);
      const tail = box(document.querySelector(".tail-scroll"));
      const dock = box(document.querySelector(".dock-stack"));
      return { height: innerHeight, tail: tail ? Math.round(tail.height) : 0, dock: dock ? Math.round(dock.height) : 0, tailBottom: tail ? Math.round(tail.bottom) : 0, dockTop: dock ? Math.round(dock.top) : 0 };
    })()`) as Promise<{ height: number; tail: number; dock: number; tailBottom: number; dockTop: number }>;

  test("BUG-0053: im Querformat bleibt dem Verlauf mindestens ein Drittel der Höhe", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "Hallo" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "Antwort", 20_000);
    await app.setViewportSize(LANDSCAPE);
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".tail-scroll")).toBeVisible();
    await app.waitForTimeout(1500);
    await expect.poll(async () => (await geometry(app)).tail).toBeGreaterThanOrEqual(LANDSCAPE.height / 3);
    const g = await geometry(app);
    expect(g.dock).toBeLessThanOrEqual(LANDSCAPE.height * 0.55); // das Dock darf nicht fast alles belegen
    expect(g.tailBottom).toBeLessThanOrEqual(g.dockTop + 1); // der Verlauf liegt über dem Dock, nicht darunter
  });

  test("Antwortfeld, Senden und die Tabs bleiben im Querformat erreichbar", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "Hallo" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "Antwort", 20_000);
    await app.setViewportSize(LANDSCAPE);
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.getByLabel("Steuerung einblenden")).toBeVisible();
    // Im Querformat startet die Steuerung eingeklappt; ein Tipp auf ▴ bringt sie zurück.
    await expect(app.getByRole("button", { name: "Senden" })).toHaveCount(0);
    await expect(app.getByRole("button", { name: "Chat" })).toBeVisible();
    await app.getByLabel("Steuerung einblenden").click();
    await expect(app.getByRole("button", { name: "Senden" })).toBeVisible();
    await expect(app.getByPlaceholder("Antworten…")).toBeVisible();
    await app.getByPlaceholder("Antworten…").fill("Querformat-Test");
    await expect(app.getByRole("button", { name: "Senden" })).toBeEnabled();
  });

  test("im Hochformat bleibt alles wie es war (Vorlagen und Modus/Modell sichtbar)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "Hallo" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "Antwort", 20_000);
    await app.setViewportSize({ width: 412, height: 915 });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".reply-templates")).toBeVisible();
    await expect(app.getByLabel("Modus")).toBeVisible();
  });
});
