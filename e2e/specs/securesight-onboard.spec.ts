import { test, expect } from "../support/fixtures.ts";

/**
 * BUG-0083: im Anbindungs-Formular der securesight-factory fror die PWA ein,
 * sobald das Formular offen war (gemeldet als Absturz bei Provider-Wahl „Z.ai“).
 * Ursache: `onboardSelectDefaults` patchte die leere erste Wahl des
 * „Modell“-Selects bei jedem Render zu einem neuen Objekt — endloser
 * Render-Loop. Hier prüft der Klick-Weg genau das: Formular offen, Seite
 * bleibt antwortbereit, Provider/Modell sind wählbar.
 */
test.describe("securesight-Anbindung: Formular bleibt reagierend", () => {
  test("Provider Z.ai wählen friert die PWA nicht ein (Repro 2026-11-01)", async ({ app }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Loop", { exact: true }).selectOption("securesight-factory");
    await app.getByLabel("Anbindung").selectOption("+neu");
    await expect(app.locator(".loop-onboard")).toBeVisible();
    // Betriebsmodus/Pflicht-Selects gelten durch Anzeige als gewählt (2026-10-30).
    await expect(app.getByRole("button", { name: "Starten" })).toBeEnabled();

    // Der Freeze war ein endloser Render-Loop: Der Hauptthread reagierte nicht
    // mehr. WaitForFunction läuft im Page-Kontext — ein blockierter Thread
    // schlägt hier an, bevor irgendein Klick es täte.
    await app.waitForFunction(() => true, null, { timeout: 3000 });

    // Die gemeldete Crash-Auslösung: Provider auf Z.ai stellen.
    await app.getByLabel("Provider").selectOption("zai");
    await expect(app.getByLabel("Provider")).toHaveValue("zai");
    await app.waitForFunction(() => true, null, { timeout: 3000 });

    // Auch die Modellwahl (Nutzerwunsch 2026-10-30) bleibt bedienbar, ohne
    // dass die Vorgabe „Standard-Routing“ einen Zustands-Loop auslöst.
    await expect(app.getByLabel("Modell", { exact: true })).toHaveValue("");
    await app.getByLabel("Modell", { exact: true }).selectOption("zai/glm-5.3");
    await expect(app.getByLabel("Modell", { exact: true })).toHaveValue("zai/glm-5.3");

    // Das Formular lebt noch: zurück auf Anthropic ist möglich.
    await app.getByLabel("Provider").selectOption("anthropic");
    await expect(app.getByLabel("Provider")).toHaveValue("anthropic");
  });
});
