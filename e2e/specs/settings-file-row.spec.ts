import { test, expect } from "../support/fixtures.ts";

/** BUG-0221: Setting-Zeilen mit file-Input dürfen die Beschriftung nicht auf
 * einen Buchstaben je Zeile quetschen — Geometrie statt Augenmaß (Muster
 * layout-beweis): gemessene Label-Breite gegen die Zeilenbreite. */

test.describe("Einstellungen: Hintergrundbild-Upload (BUG-0221)", () => {
  test("Beschriftung behält volle Zeilenbreite, das file-Input stapelt darunter", async ({ app, hub }) => {
    await app.goto(`${hub.origin}/#/einstellungen`);
    const row = app.getByLabel("Lokales Hintergrundbild").locator("..").locator("..");
    const label = row.locator(".setting-label");
    const control = row.locator(".setting-control");
    const rowBox = await row.boundingBox();
    const labelBox = await label.boundingBox();
    const controlBox = await control.boundingBox();
    expect(rowBox).not.toBeNull();
    expect(labelBox).not.toBeNull();
    expect(controlBox).not.toBeNull();
    // Beschriftung nutzt die Zeile (nicht 1 Buchstabe je Zeile) …
    expect(labelBox!.width).toBeGreaterThan(rowBox!.width * 0.6);
    // … und die Zeile bleibt in der Kartenbreite (nicht überstehend).
    expect(controlBox!.x + controlBox!.width).toBeLessThanOrEqual(rowBox!.x + rowBox!.width + 1);
  });
});
