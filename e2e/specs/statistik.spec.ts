import { test, expect } from "../support/fixtures.ts";
import type { Page } from "@playwright/test";
import { StatisticsReport } from "@ancientvoid/contracts";

/**
 * EPIC-P56 T56.3: Statistik-Seite. Echte Sessions des E2E-Hubs, echter
 * Rollup (läuft mit dem ersten Abruf), echte Schnitte. Jede Zahl mit n;
 * Klein-n gekennzeichnet; leere Schnitte sind ehrlich leer (ADR-0079).
 */

async function openStatistics(page: Page) {
  await page.setViewportSize({ width: 412, height: 850 });
  await page.reload();
  await page.getByRole("button", { name: /Mehr/ }).first().click();
  await page.getByRole("dialog", { name: "Mehr" }).getByRole("button", { name: "Statistik" }).click();
  await expect(page).toHaveURL(/#\/statistik$/);
}

test.describe("Statistik-Seite (EPIC-P56)", () => {
  test("Dock „Mehr“ → „Statistik“ zeigt Sessions mit Verteilung und n", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Statistik-Erste" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "idle");

    await openStatistics(app);
    const card = app.getByRole("region", { name: "Statistik Sessions" });
    await expect(card).toBeVisible();
    await expect(card).toContainText("opencode · e2e/fake-model");
    await expect(card).toContainText(/n \d+/);
    // Klein-n ist Pflichtkennzeichnung, kein optionaler Schmuck (AC-P56-3).
    await expect(card).toContainText("wenige Daten");

    const turns = app.getByRole("region", { name: "Statistik Züge und Tokens" });
    await expect(turns).toContainText(/Zug/);
    await expect(turns).toContainText(/geschätzt|n \d+/);
  });

  test("Zeitraum „Woche“ umfasst heutige Sessions, Projektschnitt hält sie", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Statistik-Zweite" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "idle");

    await openStatistics(app);
    const card = app.getByRole("region", { name: "Statistik Sessions" });
    await expect(card).toBeVisible();

    await app.getByRole("group", { name: "Zeitraum" }).getByRole("button", { name: "Woche" }).click();
    await expect(card).toContainText("opencode");

    // Projektschnitt über die Auswahl: das Projekt der Session bleibt sichtbar.
    const projekt = app.getByLabel("Projekt");
    const options = await projekt.locator("option").allTextContents();
    const eigenes = options.find(o => !o.includes("alle Projekte")) ?? options[0]!;
    await projekt.selectOption({ label: eigenes });
    await expect(card).toContainText("opencode");
  });

  test("API: Contract-Report, ehrlich leere Schnitte, 400 auf ungültige Query", async ({ hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Statistik-API" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "idle");

    const report = await hub.api<StatisticsReport>("/api/statistics");
    expect(report.status).toBe(200);
    expect(StatisticsReport.parse(report.body).sessions.length).toBeGreaterThan(0);

    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    const empty = await hub.api<StatisticsReport>(`/api/statistics?since=${encodeURIComponent(tomorrow)}`);
    expect(empty.status).toBe(200);
    expect(empty.body.sessions).toEqual([]);
    expect(empty.body.slices.projects.length).toBeGreaterThan(0); // Scheiben bleiben belegt

    const invalid = await hub.api("/api/statistics?since=gestern");
    expect(invalid.status).toBe(400);
  });
});
