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

  test("Anlegen → Auto-Save → Reload: Inhalt steht; Suche filtert nach Name", async ({ app, hub }) => {
    await pickVaultRoot(app, hub);
    await app.getByLabel("Neue Notiz").fill("Wichtige Erkenntnis");
    await app.getByRole("button", { name: "Anlegen" }).click();
    await expect(app.locator(".vault-row").filter({ hasText: "Wichtige Erkenntnis.md" })).toBeVisible();
    await expect(app.locator(".vault-textarea")).toBeVisible();
    await app.locator(".vault-textarea").fill("# Besser\n\nZwei Gedanken.\n");
    await expect(app.locator('[data-testid="vault-save-status"]')).toHaveText("gespeichert", { timeout: 5_000 });
    await expect(app.getByRole("button", { name: "Speichern", exact: true })).toHaveCount(0);
    await app.getByLabel("Neue Notiz").fill("Andere Notiz");
    await app.getByRole("button", { name: "Anlegen" }).click();
    await app.locator('[data-testid="vault-search"]').fill("Wichtig");
    await expect(app.locator(".vault-row").filter({ hasText: "Wichtige Erkenntnis.md" })).toBeVisible();
    await expect(app.locator(".vault-row").filter({ hasText: "Andere Notiz.md" })).toHaveCount(0);
    await app.reload();
    await app.locator(".vault-row").filter({ hasText: "Wichtige Erkenntnis.md" }).click();
    await app.getByRole("button", { name: "Bearbeiten" }).click();
    await expect(app.locator(".vault-textarea")).toHaveValue(/Besser/);
  });

  test("Stale-Revision: externe Änderung → Auto-Save verweigert sichtbar, kein stiller Verlust", async ({ app, hub }) => {
    const dir = await pickVaultRoot(app, hub);
    await app.getByLabel("Neue Notiz").fill("Konflikt");
    await app.getByRole("button", { name: "Anlegen" }).click();
    await expect(app.locator(".vault-textarea")).toBeVisible();
    // Extern ändern, bevor der Editor speichert: Revision weicht ab.
    writeFileSync(join(dir, "Konflikt.md"), "Fassung B\n");
    await app.locator(".vault-textarea").fill("Fassung A");
    await expect(app.getByText("hat sich unterdessen geändert", { exact: false })).toBeVisible({ timeout: 5_000 });
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
