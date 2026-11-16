import { test, expect, type Page } from "../support/fixtures.ts";

/** Globale Git-Struktur-Ebene: Einstieg ohne offene Session — PC-Rail-Knopf, am Handy über das
 * Mehr-Blatt (Rail-Extras sind dort ausgeblendet) — Auswahl-Kachel und Strg+Umschalt+G. */

async function openGitLayer(page: Page): Promise<void> {
  const rail = page.locator(".dock").getByRole("button", { name: "Git-Struktur", exact: true });
  if (await rail.isVisible()) {
    await rail.click();
    return;
  }
  await page.locator(".dock").getByRole("button", { name: "Mehr", exact: true }).click();
  await page.locator(".more-sheet").getByRole("button", { name: "Git-Struktur", exact: true }).click();
}

test.describe("Git-Struktur-Ebene @desktop", () => {
  test("Einstieg öffnet Auswahl-Kachel; Projekt-Kachel rendert den Commit-Graphen", async ({ app }) => {
    await openGitLayer(app);
    const layer = app.getByTestId("git-layer");
    await expect(layer).toBeVisible();
    await expect(app.getByTestId("git-picker")).toBeVisible();
    // Fixture-Projekt alpha bringt den Init-Commit aus support/hub.ts (makeProject) mit.
    await app.getByTestId("git-picker").getByRole("button", { name: "alpha", exact: true }).click();
    await expect(app.getByTestId("git-graph-pane")).toBeVisible();
    await expect(app.locator(".git-graph-row").first()).toBeVisible({ timeout: 15_000 });
    // ✕ schließt die Ebene.
    await app.getByRole("button", { name: "Git-Struktur schließen" }).click();
    await expect(layer).toHaveCount(0);
  });

  test("Strg+Umschalt+G schaltet die Ebene ein und aus", async ({ app }) => {
    await app.keyboard.press("Control+Shift+g");
    await expect(app.getByTestId("git-layer")).toBeVisible();
    await app.keyboard.press("Control+Shift+g");
    await expect(app.getByTestId("git-layer")).toHaveCount(0);
  });
});
