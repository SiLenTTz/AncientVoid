import { expect, test } from "../support/fixtures.ts";
import { dockGo } from "../support/fixtures.ts";

/**
 * BUG-0185 — die installierte App dreht nicht mit, obwohl das Manifest frei ist.
 *
 * Zwei Beweise: die Oberfläche macht den Stand auf dem Gerät lesbar (Anzeigemodus,
 * Fenster-Ausrichtung, Manifest, Worker-Stufe), und der Service Worker hält kein
 * Manifest-Exemplar fest — ein eingelagertes Exemplar war die alte, auf Hochformat
 * gesperrte Fassung, an der eine installierte App dann hängt.
 */
const manifestHolders = async (page: { evaluate: (fn: () => Promise<string[]>) => Promise<string[]> }) =>
  page.evaluate(async () => {
    const names = await caches.keys();
    const found: string[] = [];
    for (const name of names) {
      const cache = await caches.open(name);
      const entries = await cache.keys();
      if (entries.some((req) => new URL(req.url).pathname === "/manifest.webmanifest")) found.push(name);
    }
    return found;
  });

test.describe("Installierter Stand auf dem Gerät (BUG-0185)", () => {
  test("die Standzeilen nennen Manifest und Ausrichtung — ehrlich ohne Worker", async ({ app, hub }) => {
    await app.goto(hub.origin);
    await dockGo(app, "Einstellungen");
    const status = app.getByTestId("install-status");
    await expect(status, "der Stand wird gelesen, nicht geraten").toBeVisible();
    await expect(status).toContainText(/Manifest-Ausrichtung: any/);
    await expect(status).toContainText(/Anzeigemodus: Browser-Tab/);
    await expect(status).toContainText(/Fenster-Ausrichtung: portrait-primary \(hoch\)/);
    // Der E2E-Harness blockiert Service Worker (playwright.config.ts) — die Zeile sagt
    // das, statt eine Stufe vorzutäuschen.
    await expect(status).toContainText("Service-Worker-Cache: kein Worker antwortet");
    await expect(status).toContainText("Manifest-Cache: keiner (Soll)");
  });

  test("ein echter Worker hält kein Manifest fest und räumt die alte Stufe", async ({ browser, hub }) => {
    // Eigener Kontext mit erlaubten Workern: hier geht es genau um den Worker-Pfad.
    const ctx = await browser.newContext({ serviceWorkers: "allow", viewport: { width: 393, height: 767 }, hasTouch: true, isMobile: true, locale: "de-DE" });
    const page = await ctx.newPage();
    await page.addInitScript((token) => {
      localStorage.setItem("ancientvoid.token", token);
    }, hub.token);
    await page.goto(hub.origin, { waitUntil: "load" });
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
    });

    const levels = await page.evaluate(() => caches.keys());
    expect(
      levels.some((n) => /^ancientvoid-v([6-9]|\d{2,})$/.test(n)),
      `Worker-Stufe muss mindestens v6 sein, fanden: ${levels.join(", ") || "keine"}`,
    ).toBe(true);
    expect(await manifestHolders(page), "Manifest in keinem Cache — sonst dreht die installierte App nicht mit").toEqual([]);

    // Der eigentliche Haaken: die Oberflaeche holt das Manifest selbst. Danach darf es
    // immer noch in keinem Cache liegen — sonst gewinnt nach dem ersten Settings-Besuch
    // wieder das eingelagerte Exemplar (auf dem Geraet so gemessen).
    await page.goto(`${hub.origin}/#/einstellungen`, { waitUntil: "load" });
    const status = page.getByTestId("install-status");
    await expect(status).toContainText(/Manifest-Ausrichtung: any/, { timeout: 15_000 });
    await expect(status).toContainText("Manifest-Cache: keiner (Soll)");
    await expect(status).toContainText(/Service-Worker-Cache: ancientvoid-v([6-9]|\d{2,})/);
    expect(await manifestHolders(page), "auch nach dem Settings-Besuch kein Manifest im Cache").toEqual([]);
    await ctx.close();
  });
});
