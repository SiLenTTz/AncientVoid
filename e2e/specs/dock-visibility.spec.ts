import { test, expect } from "../support/fixtures.ts";

/**
 * BUG-0098: Der fixierte Dock ist höhenunbegrenzt — mit viel Steuerung
 * (Konfiguration, Warteschlange, Vorlagen, Eingabe) auf kleinem Screen
 * stehen die obersten Buttons über dem oberen Rand: abgeschnitten statt
 * bedienbar. Der Dock muss selbst scrollen, statt aus dem Bild zu laufen.
 */
test.describe("Dock bleibt bedienbar", () => {
  test("P41: acht globale Ziele bleiben bei 412 px lesbar und bei 320 px erreichbar", async ({ app }) => {
    await app.setViewportSize({ width: 412, height: 850 });
    const dock = app.locator(".dock");
    await expect(dock.getByRole("button")).toHaveCount(8);
    const size = await dock.evaluate((el) => ({ width: el.clientWidth, content: el.scrollWidth }));
    expect(size.content, "alle acht Ziele müssen bei 412 px in den Dock passen").toBeLessThanOrEqual(size.width + 1);
    for (const button of await dock.getByRole("button").all()) {
      const bounds = await button.evaluate((el) => {
        const b = el.getBoundingClientRect();
        const label = el.querySelector(".lb")!.getBoundingClientRect();
        return { left: b.left, right: b.right, width: b.width, labelLeft: label.left, labelRight: label.right };
      });
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.labelLeft).toBeGreaterThanOrEqual(bounds.left - 1);
      expect(bounds.labelRight).toBeLessThanOrEqual(bounds.right + 1);
    }
    await app.setViewportSize({ width: 320, height: 850 });
    await dock.getByRole("button", { name: "Einstellungen" }).click();
    await expect(app).toHaveURL(/#\/einstellungen$/);
    await expect(dock.getByRole("button", { name: "Einstellungen" })).toBeInViewport();
    const page = await app.evaluate(() => ({ width: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
    expect(page.content).toBeLessThanOrEqual(page.width + 1);
  });

  test("BUG-0098: ein hoher Dock schneidet keine Buttons ab — er scrollt selbst", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "LANGSAM erste Frage" });
    await app.setViewportSize({ width: 412, height: 350 });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    // BUG-0053: kleiner Viewport klappt die Steuerung automatisch ein —
    // für diesen Test gehört sie aus: Der Dock muss auch ausgeklappt
    // vollständig bedienbar bleiben. Erst sicher warten, dass der Toggle
    // gerendert ist, sonst verpasst count() ihn beim App-Boot.
    const einblenden = app.getByLabel("Steuerung einblenden");
    await expect(einblenden.or(app.getByLabel("Steuerung ausblenden"))).toBeVisible();
    if (await einblenden.count()) {
      await einblenden.click();
    }
    await expect(app.getByPlaceholder("Antworten…")).toBeVisible({ timeout: 15_000 });
    // Fünf vorgemerkte Nachrichten füllen den Dock über die Bildschirmhöhe.
    for (const text of ["Frage eins", "Frage zwei", "Frage drei", "Frage vier", "Frage fünf"]) {
      await app.getByPlaceholder("Antworten…").fill(text);
      await app.getByRole("button", { name: "Vormerken" }).click();
      await expect(app.locator(".queue-list")).toContainText(text);
    }
    await app.getByPlaceholder("Antworten…").fill("");

    const m = await app.evaluate(() => {
      const dock = document.querySelector(".dock-stack") as HTMLElement;
      const r = dock.getBoundingClientRect();
      const toggle = dock.querySelector(".dock-toggle") as HTMLElement | null;
      return {
        dockTop: Math.round(r.top),
        dockHeight: Math.round(r.height),
        viewport: window.innerHeight,
        toggleTop: toggle ? Math.round(toggle.getBoundingClientRect().top) : null,
        dockScrollable: dock.scrollHeight > dock.clientHeight + 1,
      };
    });
    expect(m.dockTop, "Dock-Oberkante muss im Bild liegen (>=0)").toBeGreaterThanOrEqual(0);
    expect(m.dockHeight, "Dock höher als der Bildschirm").toBeLessThanOrEqual(m.viewport + 1);
    expect(m.toggleTop, "der Ein-/Ausklapp-Knopf muss sichtbar sein").toBeGreaterThanOrEqual(0);
  });
});
