import { test, expect } from "../support/fixtures.ts";

test.describe("Anmeldung per Geräte-Token (BUG-0006, AC-P4.5-4)", () => {
  test("ohne Token erscheint die Token-Eingabe @desktop", async ({ page, hub }) => {
    await page.goto(hub.origin);
    await expect(page.getByRole("heading", { name: "UACC Hub" })).toBeVisible();
    await expect(page.getByLabel("Device-Token")).toBeVisible();
  });

  test("BUG-0054: ein gespeichertes falsches Token nennt den Grund, statt stumm zu bleiben", async ({ page, hub }) => {
    await page.addInitScript(() => localStorage.setItem("uacc.token", "alt-und-falsch"));
    await page.goto(hub.origin);
    await expect(page.getByRole("heading", { name: "UACC Hub" })).toBeVisible();
    await expect(page.getByText(/401|unauthori[sz]ed|token/i).last()).toBeVisible();
    await expect(page.getByRole("heading", { name: "UACC", exact: true })).toHaveCount(0);
  });

  test("ein falsches Token wird abgelehnt und die Eingabe bleibt", async ({ page, hub }) => {
    await page.goto(hub.origin);
    await page.getByLabel("Device-Token").fill("falsches-token");
    await page.getByRole("button", { name: "Verbinden" }).click();
    await expect(page.getByText(/401|unauthori[sz]ed|token/i).last()).toBeVisible();
    await expect(page.getByRole("heading", { name: "UACC Hub" })).toBeVisible();
  });

  test("ein gültiges Token öffnet die Übersicht und überlebt einen Reload @desktop", async ({ page, hub }) => {
    await page.goto(hub.origin);
    await page.getByLabel("Device-Token").fill(hub.token);
    await page.getByRole("button", { name: "Verbinden" }).click();
    await expect(page.getByRole("heading", { name: "UACC", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "UACC", exact: true })).toBeVisible();
  });

  test("das Auge zeigt das Token im Klartext", async ({ page, hub }) => {
    await page.goto(hub.origin);
    const field = page.getByLabel("Device-Token");
    await expect(field).toHaveAttribute("type", "password");
    await page.getByTitle("Token anzeigen").click();
    await expect(field).toHaveAttribute("type", "text");
  });

  test("„Geräte-Token wechseln“ führt zurück zur Eingabe", async ({ app }) => {
    await app.locator(".dock").getByRole("button", { name: "Einstellungen" }).click();
    await app.getByRole("button", { name: "Geräte-Token wechseln" }).click();
    await expect(app.getByRole("heading", { name: "UACC Hub" })).toBeVisible();
  });
});
