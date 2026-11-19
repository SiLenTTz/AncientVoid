import { test, expect } from "../support/fixtures.ts";

/** EPIC-P73 (ADR-0094): externe Auto-Jobs — GitHub-Actions-Anzeige und
 * Issue-Session-Bridge. Der E2E-Hub fährt ohne `issues`-Sektion: Die Sektion
 * zeigt den ehrlichen „nicht konfiguriert"-Zustand, der Endpunkt antwortet
 * leer statt 501 (kein Scheduler nötig). */

test.describe("Externe Automatismen (EPIC-P73)", () => {
  test("Endpunkt antwortet ohne Konfiguration ehrlich leer, Sektion zeigt „nicht konfiguriert“", async ({ app, hub }) => {
    const res = await hub.api<{ atUtc: string; staleError: string | null; jobs: unknown[] }>("/api/automations/external");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ staleError: null, jobs: [] });

    await app.goto(`${hub.origin}/#/automationen`);
    const section = app.getByTestId("external-jobs-section");
    await expect(section).toBeVisible();
    await expect(section).toContainText("Externe Automatismen");
    await expect(app.getByTestId("external-jobs-empty")).toContainText(/Keine externen Automatismen konfiguriert/);
  });
});
