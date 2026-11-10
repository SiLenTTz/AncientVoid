import { test, expect } from "../support/fixtures.ts";
import type { TestHub } from "../support/hub.ts";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** EPIC-P49 (ADR-0063): Knowledge Vault — Picker, Liste, Editor, Fenster. */

async function pickVaultRoot(app: Page, hub: TestHub): Promise<string> {
  const vaultDir = join(hub.projectsDir, "notizen-vault");
  mkdirSync(vaultDir, { recursive: true });
  await app.goto(`${hub.origin}/#/notizen`);
  await expect(app.locator('[data-testid="vault-picker"]')).toBeVisible();
  await app.getByRole("button", { name: "📁 projects" }).click();
  await app.getByRole("button", { name: "📁 notizen-vault" }).click();
  await app.locator('[data-testid="vault-choose"]').click();
  await expect(app.locator('[data-testid="vault-pane"]')).toBeVisible();
  return vaultDir;
}

test.describe("Knowledge Vault (EPIC-P49)", () => {
  test("Erstöffnen ohne Ordner: Picker, Wahl bleibt über Reload (SettingsStore)", async ({ app, hub }) => {
    await pickVaultRoot(app, hub);
    await app.reload();
    await expect(app.locator('[data-testid="vault-pane"]')).toBeVisible();
    await expect(app.locator(".vault-title")).toContainText("notizen-vault");
  });

  test("Anlegen → Bearbeiten → Speichern → Reload: Inhalt steht", async ({ app, hub }) => {
    await pickVaultRoot(app, hub);
    await app.getByLabel("Neue Notiz").fill("Wichtige Erkenntnis");
    await app.getByRole("button", { name: "Anlegen" }).click();
    await expect(app.locator(".vault-row").filter({ hasText: "Wichtige Erkenntnis.md" })).toBeVisible();
    // Nach dem Anlegen direkt im Editor.
    await expect(app.locator(".vault-textarea")).toBeVisible();
    await app.locator(".vault-textarea").fill("# Besser\n\nZwei Gedanken.\n");
    await app.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect(app.getByText("gespeichert")).toBeVisible();
    await app.reload();
    await app.locator(".vault-row").filter({ hasText: "Wichtige Erkenntnis.md" }).click();
    await app.getByRole("button", { name: "Bearbeiten" }).click();
    await expect(app.locator(".vault-textarea")).toHaveValue(/Besser/);
  });

  test("Stale-Revision: externe Änderung → Speichern verweigert sichtbar, kein stiller Verlust", async ({ app, hub }) => {
    const dir = await pickVaultRoot(app, hub);
    await app.getByLabel("Neue Notiz").fill("Konflikt");
    await app.getByRole("button", { name: "Anlegen" }).click();
    await expect(app.locator(".vault-textarea")).toBeVisible();
    await app.locator(".vault-textarea").fill("Fassung A");
    // Extern ändern (wie ein anderes Fenster): die Revision weicht unter dem Editor ab.
    writeFileSync(join(dir, "Konflikt.md"), "Fassung B\n");
    await app.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect(app.getByText("hat sich unterdessen geändert", { exact: false })).toBeVisible();
    // Der fehlgeschlagene Save überschreibt die externe Fassung nicht (kein stiller Verlust).
    expect(readFileSync(join(dir, "Konflikt.md"), "utf8")).toBe("Fassung B\n");
  });

  test("Nicht-markdown nur anschaubar; md mit Ansehen/Bearbeiten", async ({ app, hub }) => {
    const dir = await pickVaultRoot(app, hub);
    writeFileSync(join(dir, "liste.csv"), "a;b\n1;2\n");
    await app.reload();
    await app.locator(".vault-row").filter({ hasText: "liste.csv" }).click();
    await expect(app.locator('[data-testid="file-viewer"]')).toBeVisible();
    await expect(app.getByRole("button", { name: "Bearbeiten" })).toHaveCount(0);
  });

  test("Datei-Deep-Link und eigenes Fenster", async ({ app, hub, context }) => {
    const dir = await pickVaultRoot(app, hub);
    writeFileSync(join(dir, "notiz.md"), "# Gemerkt\n\nInhalt.\n");
    await app.goto(`${hub.origin}/#/notizen/datei/notiz.md`);
    await expect(app.locator(".vault-file-name")).toContainText("notiz.md");
    const popupP = context.waitForEvent("page");
    await app.getByRole("button", { name: "Datei in eigenes Fenster" }).click();
    const popup = await popupP;
    await popup.waitForLoadState();
    expect(popup.url()).toContain("/notizen/datei/notiz.md");
    await expect(popup.locator(".vault-file-name")).toContainText("notiz.md");
    await expect(popup.locator(".dock, .split-list, .tile-bar")).toHaveCount(0);
  });
});
