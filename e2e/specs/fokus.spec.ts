import { test, expect } from "../support/fixtures.ts";

/**
 * EPIC-P63 T63.8 / AC-P63-5: Fokus-Reihenfolge Dock → Inhalt → Composer,
 * Fokusfalle im Sheet, Esc schließt und gibt den Fokus zurück.
 * Ergänzt tastatur-screenreader.spec.ts (Nyx) und shortcuts.spec.ts (Esc).
 */

test.describe("Fokus und Sheet (EPIC-P63 T63.8)", () => {
  test("Session: Tab erreicht Dock und Composer; Fokus ist sichtbar @desktop", async ({ app, hub, isMobile }) => {
    test.skip(isMobile, "Tab-Reihenfolge Dock→Composer ist die PC-Messlatte");
    const id = await hub.createSession({ adapter: "opencode", prompt: "Fokus-Probe" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.getByPlaceholder("Antworten…")).toBeVisible();

    const dockStart = app.locator(".dock .dock-item").first();
    let reachedDock = false;
    for (let i = 0; i < 60 && !reachedDock; i++) {
      await app.keyboard.press("Tab");
      reachedDock = await dockStart.evaluate((el) => el === document.activeElement);
    }
    expect(reachedDock, "Dock-Eintrag per Tab erreichbar").toBe(true);
    const dockOutline = await dockStart.evaluate((el) => {
      const st = getComputedStyle(el);
      return (st.outlineStyle !== "none" && parseFloat(st.outlineWidth) > 0) || st.boxShadow !== "none";
    });
    expect(dockOutline, "Fokus auf dem Dock sichtbar").toBe(true);

    const composer = app.getByPlaceholder("Antworten…");
    let reachedComposer = false;
    for (let i = 0; i < 80 && !reachedComposer; i++) {
      await app.keyboard.press("Tab");
      reachedComposer = await composer.evaluate((el) => el === document.activeElement);
    }
    expect(reachedComposer, "Composer per Tab nach dem Dock erreichbar").toBe(true);
  });

  // „Mehr“ gibt es nur am Handy/Tablet — am PC stehen die Ziele einzeln in der Leiste.
  test("Mehr-Sheet: Fokusfalle und Esc zurück auf den Auslöser", async ({ app, hub, isMobile }) => {
    test.skip(!isMobile, "Mehr-Sheet nur am schmalen Dock");
    await hub.createSession({ adapter: "opencode", prompt: "Kurz" });
    const more = app.locator(".dock .dock-more");
    await expect(more).toBeVisible();
    await more.click();
    const sheet = app.getByRole("dialog", { name: "Mehr" });
    await expect(sheet).toBeVisible();
    // useOverlayFocus setzt den Fokus auf das erste fokussierbare Kind (more-item).
    await expect(sheet.locator("button").first()).toBeFocused();

    for (let i = 0; i < 20; i++) await app.keyboard.press("Tab");
    expect(await sheet.evaluate((el) => el.contains(document.activeElement)), "Fokusfalle nach vielen Tabs").toBe(true);

    await app.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(more).toBeFocused();
  });

  test("Skill-Sheet: Esc schließt, Fokus zurück auf den Chip", async ({ app, hub }) => {
    await app.goto(`${hub.origin}/#/neu`);
    await app.getByLabel("Adapter").selectOption("claude");
    const chip = app.locator("button.skill-chip").first();
    await expect(chip).toBeVisible();
    await chip.click();
    const sheet = app.getByRole("dialog", { name: "Skill oder Agent wählen" });
    await expect(sheet).toBeVisible();
    await app.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(chip).toBeFocused();
  });
});
