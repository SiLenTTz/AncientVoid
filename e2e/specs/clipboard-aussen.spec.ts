import { test, expect, type Page } from "../support/fixtures.ts";

/**
 * ADR-0093: was ausserhalb der App kopiert wurde, kommt beim Wiederkommen in die
 * Ablage — Text als Stufe „Andere App“, ein Screenshot als Bild-Stufe mit echtem
 * Vorschaubild, und ein solches Bild haengt sich an die Session an (derselbe Weg wie
 * die Bueroeklammer: Hochladen, Lese-Status). Ohne den Fix gibt es keine
 * „Andere App“-Stufe, kein Bild in der Ablage und keinen Schalter dafuer.
 */
test.describe("Ablage nimmt extern Kopiertes (ADR-0093)", () => {
  test.beforeEach(async ({ app, hub }) => {
    test.setTimeout(90_000);
    await app.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: hub.origin });
  });

  /**
   * Die App schaut beim Wiederkommen ins Clipboard, aber hoechstens alle drei Sekunden
   * (kein Lausch-Timer). Also: zurueckkommen, nachsehen, einmal nachlegen.
   */
  const marke = (app: Page): Promise<string | null> =>
    app.evaluate(() => document.querySelector<HTMLElement>('[data-testid="clipboard-count"]')?.textContent ?? null);

  const wiederkommen = async (app: Page, erwartet: number): Promise<void> => {
    for (let versuch = 0; versuch < 3; versuch += 1) {
      await app.evaluate(() => window.dispatchEvent(new Event("focus")));
      await app.waitForTimeout(1200);
      if ((await marke(app)) === String(erwartet)) return;
      await app.waitForTimeout(3300);
    }
  };

  const sitzungOeffnen = async (app: Page, hub: { origin: string; createSession: (o: { adapter: string; prompt: string }) => Promise<string> }) => {
    const id = await hub.createSession({ adapter: "dummy", prompt: "Start" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.bringToFront();
    await app.locator(".composer-input").click();
    return id;
  };

  test("extern kopierter Text wird eine Stufe mit der Herkunft „Andere App“", async ({ app, hub }) => {
    const marker = "GRUSS_AUS_ANDERER_APP_0093";
    await sitzungOeffnen(app, hub);
    await app.evaluate(async (text) => {
      await navigator.clipboard.writeText(text);
    }, marker);
    await wiederkommen(app, 1);

    await app.getByTestId("clipboard-open").click();
    const liste = app.getByTestId("shelf-list");
    await expect(liste).toContainText(marker);
    await expect(liste).toContainText("Andere App");
  });

  test("ein Screenshot von aussen wird Bild-Stufe — und haengt sich an die Session an", async ({ app, hub }) => {
    await sitzungOeffnen(app, hub);
    await app.evaluate(async () => {
      const leinwand = document.createElement("canvas");
      leinwand.width = 120;
      leinwand.height = 90;
      const maler = leinwand.getContext("2d");
      if (!maler) throw new Error("kein Canvas");
      maler.fillStyle = "#7b3ff2";
      maler.fillRect(0, 0, 120, 90);
      const blob = await new Promise<Blob>((loesung) => leinwand.toBlob((b) => loesung(b as Blob), "image/png"));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    });
    await wiederkommen(app, 1);

    await app.getByTestId("clipboard-open").click();
    const zeile = app.getByTestId("shelf-row").filter({ has: app.getByTestId("shelf-thumb") }).first();
    await expect(zeile).toBeVisible();
    await expect(zeile).toContainText("120 × 90");

    await zeile.getByTestId("shelf-attach").click();
    await expect(app.getByTestId("attachment-chip").filter({ hasText: "screenshot-" })).toBeVisible();
  });

  test("der Schalter nimmt extern Kopiertes heraus — und laesst es wieder zu", async ({ app, hub }) => {
    const marker = "DARF_NICHT_REINKOMMEN_0093";
    await sitzungOeffnen(app, hub);

    await app.getByTestId("clipboard-open").click();
    await expect(app.getByRole("switch", { name: "aus anderen Apps übernehmen" })).toBeChecked();
    await app.getByRole("switch", { name: "aus anderen Apps übernehmen" }).uncheck();

    await app.evaluate(async (text) => {
      await navigator.clipboard.writeText(text);
    }, marker);
    // Der Blick ins Clipboard ist hoechstens alle drei Sekunden faellig — warten, dann zurueck.
    await app.waitForTimeout(3400);
    await app.evaluate(() => window.dispatchEvent(new Event("focus")));
    await app.waitForTimeout(1200);
    await expect(app.getByTestId("shelf-list")).toHaveCount(0);
    await expect(app.getByRole("switch", { name: "aus anderen Apps übernehmen" })).not.toBeChecked();

    await app.getByRole("switch", { name: "aus anderen Apps übernehmen" }).check();
    await app.waitForTimeout(3400);
    await app.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(app.getByTestId("shelf-list")).toContainText(marker, { timeout: 15_000 });
  });
});
