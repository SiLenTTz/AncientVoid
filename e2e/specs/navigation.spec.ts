import { test, expect } from "../support/fixtures.ts";

test.describe("Navigation, Status und Einstellungen (P1.6)", () => {
  test("das Dock erreicht jede Seite und kommt zurück @desktop", async ({ app }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await expect(app.getByRole("button", { name: "Starten" })).toBeVisible();
    await app.getByRole("button", { name: "Einstellungen" }).click();
    await expect(app.getByText("Erscheinungsbild")).toBeVisible();
    await app.getByRole("button", { name: "Übersicht" }).click();
    await expect(app.getByText("keine Sessions — lege eine an")).toBeVisible();
  });

  test("die Status-Seite zeigt jeden Provider mit seinen Fähigkeiten", async ({ app }) => {
    await app.getByRole("button", { name: "Status" }).click();
    const opencode = app.locator(".provider-card").filter({ hasText: "opencode" });
    const dummy = app.locator(".provider-card").filter({ hasText: "dummy" });
    await expect(opencode).toContainText("v0.1.0");
    await expect(opencode.getByText("Kosten")).toBeVisible();
    // ADR-0018: functions one by one, and how tools are released.
    await expect(opencode.getByText("Folgeprompt")).toBeVisible();
    await expect(opencode.getByText("Modellwahl")).toBeVisible();
    await expect(opencode.locator(".tool-gate")).toHaveText("feste Tool-Liste, ohne Nachfrage");
    await expect(dummy.locator(".tool-gate")).toHaveText("keine Tools");
    await expect(dummy.getByText("Kosten")).toHaveCount(0);
    await expect(dummy).toContainText("Kein Kontingent-Signal");
  });

  test("das helle Design bleibt nach einem Reload", async ({ app }) => {
    await app.getByRole("button", { name: "Einstellungen" }).click();
    await app.getByRole("button", { name: "☾ Dunkel" }).click();
    await expect(app.locator("html")).toHaveAttribute("data-theme", "light");
    await app.reload();
    await expect(app.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("die Einstellungen nennen die gefundenen Projekte und den Passkey-Stand", async ({ app }) => {
    await app.getByRole("button", { name: "Einstellungen" }).click();
    await expect(app.getByText("2 Projekte gefunden")).toBeVisible();
    await expect(app.getByText("•••• aktiv")).toBeVisible();
    await expect(app.getByRole("button", { name: "Passkey registrieren" })).toBeVisible();
  });

  test("das Voice-Sheet öffnet und schließt sich", async ({ app }) => {
    await app.getByRole("button", { name: "Voice" }).click();
    await expect(app.getByText("Sprachbefehl", { exact: true })).toBeVisible();
    await app.getByRole("button", { name: "✕" }).click();
    await expect(app.getByText("Sprachbefehl", { exact: true })).toHaveCount(0);
  });
});
