import { test, expect } from "../support/fixtures.ts";

/**
 * ADR-0060: eigene Modelle und Endpunkte am Modell-Dropdown. pi ist hier die Attrappe `e2e/support/bin/pi`
 * (`--list-models`), `PI_CODING_AGENT_DIR` liegt im Wegwerf-Verzeichnis — die echte models.json bleibt unberührt.
 */
test.describe("Eigene Modelle und Endpunkte", () => {
  test("pi zeigt seinen Katalog; ein eigener Endpunkt und ein eigenes Modell stehen sofort im Dropdown", async ({ app }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Adapter").selectOption("pi");
    const model = app.getByRole("combobox", { name: /^Modell/ });
    await expect(model.locator("option", { hasText: "evo/qwen-e2e" })).toHaveCount(1);

    await app.getByRole("button", { name: /Eigenes Modell/ }).click();
    const dialog = app.getByRole("dialog", { name: /Eigenes Modell oder Endpunkt/ });
    await dialog.getByRole("tab", { name: /Endpunkt/ }).click();
    await dialog.getByLabel("Name des Providers").fill("evo-evox2");
    await dialog.getByLabel("Basis-URL").fill("http://100.65.133.28:8100/v1");
    await dialog.getByLabel(/API-Schlüssel/).fill("$EVOX2_KEY");
    await dialog.getByLabel("Modell-Id am Endpunkt").fill("halogen-qwen3.8");
    await dialog.getByRole("button", { name: "Eintragen" }).click();
    await expect(dialog.getByText(/in pi eingetragen/)).toBeVisible();
    // Doppelt anlegen verlangt ausdrückliche Bestätigung statt still zu überschreiben.
    await dialog.getByRole("button", { name: "Eintragen" }).click();
    await expect(dialog.getByText(/gibt es in pi schon/)).toBeVisible();
    await expect(dialog.getByLabel(/bestehenden Provider in pi ersetzen/)).toBeVisible();

    await dialog.getByRole("tab", { name: "Modell" }).click();
    await dialog.getByLabel("Modell-Id").fill("anthropic/claude-opus-5-5");
    await dialog.getByLabel(/Anzeigename/).fill("Opus 5.5");
    await dialog.getByRole("button", { name: "Speichern" }).click();
    await expect(dialog.getByText(/steht jetzt im Dropdown/)).toBeVisible();
    await dialog.getByRole("button", { name: "Schließen" }).click();

    await expect(model.locator("option", { hasText: "evo-evox2/halogen-qwen3.8" })).toHaveCount(1);
    await expect(model.locator("option", { hasText: "Opus 5.5 · eigenes" })).toHaveCount(1);
  });
});
