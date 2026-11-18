import { test, expect, dockGo } from "../support/fixtures.ts";
import type { Page } from "@playwright/test";

/** EPIC-P67 T67.7 / ADR-0088: Einstellungsabschnitt „Main-Synchronisation“. */
async function openSettings(app: Page): Promise<void> {
  await dockGo(app, "Einstellungen");
  await expect(app.getByTestId("main-sync-settings")).toBeVisible();
}

test.describe("Einstellungen: Main-Synchronisation (EPIC-P67 T67.7)", () => {
  test("Abschnitt erreichbar, zeigt die Defaults, global speichern überlebt Neuladen", async ({ app, hub }) => {
    await openSettings(app);
    const section = app.getByTestId("main-sync-settings");
    // Defaults (ADR-0088 §1): Stufe 1 an, alles Autonome aus
    await expect(section.locator(".setting-row", { hasText: "Neue Sessions starten auf" }).first().getByRole("button", { name: "origin/Hauptbranch" })).toHaveAttribute("aria-pressed", "true");
    await expect(section.locator(".setting-row", { hasText: "Bei Rückstand" }).getByRole("button", { name: "melden" })).toHaveAttribute("aria-pressed", "true");

    // Ändern: bei Rückstand fragen, Takt auf 15 min
    await section.locator(".setting-row", { hasText: "Bei Rückstand" }).getByRole("button", { name: "fragen" }).click();
    await section.getByLabel("Prüfen alle").selectOption("15");
    await section.getByRole("button", { name: "Speichern" }).click();
    await expect(section.locator(".gemini-state.ok")).toBeVisible();

    const saved = (await hub.api<{ global: { value: { behindAction: string; checkIntervalMin: number } } }>("/api/settings/main-sync")).body;
    expect(saved.global.value).toMatchObject({ behindAction: "ask", checkIntervalMin: 15 });

    // Neuladen: gespeicherte Werte kommen vom Hub, nicht aus dem Speicher der Seite
    await app.reload();
    await openSettings(app);
    const reloaded = app.getByTestId("main-sync-settings");
    await expect(reloaded.locator(".setting-row", { hasText: "Bei Rückstand" }).getByRole("button", { name: "fragen" })).toHaveAttribute("aria-pressed", "true");
    await expect(reloaded.getByLabel("Prüfen alle")).toHaveValue("15");
  });

  test("Projekt-Überschreibung: hinzufügen, speichern, entfernen — gegen die API gelesen", async ({ app, hub }) => {
    const projects = (await hub.api<{ projects: Array<{ path: string; name: string }> }>("/api/projects")).body;
    const alpha = projects.projects.find((p) => p.name === "alpha");
    expect(alpha).toBeDefined();

    await openSettings(app);
    const section = app.getByTestId("main-sync-settings");

    await section.getByLabel("Projekt hinzufügen").selectOption(alpha!.path);
    await section.getByRole("button", { name: "Übernehmen" }).click();
    const override = section.getByTestId("main-sync-override");
    await expect(override).toBeVisible();
    await override.getByLabel(`Neue Sessions (${alpha!.path})`).selectOption("off");
    await section.getByRole("button", { name: "Speichern" }).click();
    await expect(section.locator(".gemini-state.ok")).toBeVisible();

    const saved = (await hub.api<{ projects: { value: Record<string, { startSync?: string }> } }>("/api/settings/main-sync")).body;
    expect(saved.projects.value[alpha!.path]).toEqual({ startSync: "off" });

    await override.getByRole("button", { name: "Entfernen" }).click();
    await section.getByRole("button", { name: "Speichern" }).click();
    await expect(section.locator(".gemini-state.ok")).toBeVisible();
    const after = (await hub.api<{ projects: { value: Record<string, unknown> } }>("/api/settings/main-sync")).body;
    expect(after.projects.value[alpha!.path]).toBeUndefined();
  });

  test("Erklärtext nennt, was nicht passiert (kein Rebase, kein Push, kein Eingriff)", async ({ app }) => {
    await openSettings(app);
    await expect(app.getByTestId("main-sync-settings").locator(".settings-intro")).toContainText("kein Rebase");
    await expect(app.getByTestId("main-sync-settings").locator(".settings-intro")).toContainText("wartende Sessions");
  });
});
