import { test, expect, dockGo } from "../support/fixtures.ts";
import type { Page } from "@playwright/test";

/** EPIC-P34 T34.2: Werkzeugseiten nutzen am Desktop die Detailspalte; die Kacheln bleiben dahinter gemountet. */
test.describe("Werkzeugfläche am Desktop (EPIC-P34)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  const card = (app: Page, text: string) => app.locator(".split-list .session-card").filter({ hasText: text }).locator(".session-open");

  test("AC-P34-2: Einstellungen, Medien, PC und Status füllen die Detailspalte, die Liste bleibt die Sessionliste; Entdeckt ist seit EPIC-P47 ein Übersichtszustand @desktop", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Aufgabe Eins" });
    const detail = app.locator(".split-detail");
    const detailBox = await detail.boundingBox();
    for (const [dock, marker] of [
      ["Einstellungen", ".settings-page"],
      ["Medien", ".media-caps"],
    ] as const) {
      await app.locator(".dock").getByRole("button", { name: dock }).click();
      const pane = app.locator(".tool-pane");
      await expect(pane).toBeVisible();
      await expect(pane.locator(marker).first()).toBeVisible();
      const box = (await pane.boundingBox())!;
      expect(box.width, `${dock}: Breite der Detailspalte`).toBeGreaterThanOrEqual(detailBox!.width - 2);
      // Die Sessionliste links bleibt, was sie ist.
      await expect(app.locator(".split-list .session-card").filter({ hasText: "Aufgabe Eins" })).toBeVisible();
    }
    await app.goto(`${hub.origin}/#/pc`);
    await expect(app.locator(".tool-pane [data-testid=desktop-setup], .tool-pane .desktop-head").first()).toBeVisible();
    await app.goto(`${hub.origin}/#/status`);
    await expect(app.locator(".tool-pane .provider-card").first()).toBeVisible();
    // Neu und Freigaben bleiben in der Liste (K1-Weg unverändert).
    await app.locator(".dock").getByRole("button", { name: "Neue Session" }).click();
    await expect(app.locator(".tool-pane")).toHaveCount(0);
    await expect(app.locator(".split-list").getByRole("button", { name: "Starten" })).toBeVisible();
  });

  test("AC-P34-2: Öffnen und Schließen baut keine Kachel-Verbindung neu auf, der Entwurf bleibt @desktop", async ({ app, hub }) => {
    await app.addInitScript(() => {
      const w = window as unknown as { __ws: number };
      w.__ws = 0;
      const Native = window.WebSocket;
      window.WebSocket = class extends Native {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          w.__ws += 1;
        }
      } as typeof WebSocket;
    });
    await hub.createSession({ adapter: "opencode", prompt: "Aufgabe Eins" });
    await app.reload();
    await card(app, "Aufgabe Eins").click();
    const field = app.locator(".split-detail").getByPlaceholder("Antworten…");
    await field.fill("Entwurf, noch nicht gesendet");
    const before = await app.evaluate(() => (window as unknown as { __ws: number }).__ws);
    expect(before).toBeGreaterThan(0);

    await dockGo(app, "Einstellungen");
    await expect(app.locator(".tool-pane")).toBeVisible();
    // Dahinter bleibt die Kachel gemountet, ist aber nicht bedienbar (Tastatur und Screenreader).
    await expect(field).toHaveValue("Entwurf, noch nicht gesendet");
    await expect(app.locator(".tile-host")).toHaveAttribute("inert", "");
    await app.locator(".tool-pane").getByRole("button", { name: "Schließen" }).click();
    await expect(app.locator(".tool-pane")).toHaveCount(0);
    await expect(field).toHaveValue("Entwurf, noch nicht gesendet");
    await expect(app.locator(".tile-host")).not.toHaveAttribute("inert", "");
    expect(await app.evaluate(() => (window as unknown as { __ws: number }).__ws), "WebSocket-Aufbauten").toBe(before);
  });

  test("Esc schließt die Werkzeugfläche, eine Session aus der Liste ebenfalls @desktop", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Aufgabe Eins" });
    await dockGo(app, "Einstellungen");
    await expect(app.locator(".tool-pane")).toBeVisible();
    await app.keyboard.press("Escape");
    await expect(app.locator(".tool-pane")).toHaveCount(0);
    await dockGo(app, "Notizen");
    await expect(app.locator(".tool-pane")).toBeVisible();
    await card(app, "Aufgabe Eins").click();
    await expect(app.locator(".tool-pane")).toHaveCount(0);
    await expect(app.locator(".split-detail .session-top-title")).toHaveText("Aufgabe Eins");
  });

  test("am Handy bleibt alles eine Seite, es gibt keine Werkzeugfläche", async ({ app }) => {
    await app.setViewportSize({ width: 390, height: 800 });
    await app.reload();
    await dockGo(app, "Einstellungen");
    await expect(app.locator(".tool-pane")).toHaveCount(0);
    await expect(app.getByText("Erscheinungsbild")).toBeVisible();
  });
});
