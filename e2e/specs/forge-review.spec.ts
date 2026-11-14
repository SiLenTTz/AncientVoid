import { test, expect, sessionTab } from "../support/fixtures.ts";
import type { Page } from "@playwright/test";
import type { TestHub } from "../support/hub.ts";

/**
 * EPIC-P37 T37.6: GitLab im Session-Kontext gegen den glab-Stub
 * (e2e/support/bin/glab — nur GET, keine Mutation): MR verknüpfen →
 * Pipelines/Jobs inkl. Bridge → Trace → Befund über Vorschau an den Agenten →
 * Hub-Crash (K7) → lösen. Die Abnahme gegen ein echtes, isoliertes GitLab-Projekt
 * steht im Runbook (docs/forge-runbook.md) und ist nicht Teil dieses Gates.
 */

const MR_URL = "https://gitlab.example/team/proj/-/merge_requests/7";

async function openForge(app: Page, hub: TestHub, id: string): Promise<void> {
  await app.goto(`${hub.origin}/#/sessions/${id}`);
  await sessionTab(app, "GitLab");
}

test.describe("GitLab im Session-Kontext (EPIC-P37)", () => {
  test("Verknüpfen → Pipelines/Jobs → Trace → Befund senden → Hub-Crash → Lösen", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "turn over");

    await openForge(app, hub, id);
    await app.getByPlaceholder(MR_URL).fill(MR_URL);
    await app.getByRole("button", { name: "verknüpfen" }).click();
    await expect(app.locator(".fp-mr-title")).toContainText("Forge E2E");
    await expect(app.locator(".fp-mr-head .fp-chip").filter({ hasText: "Draft" })).toBeVisible();
    await expect(app.locator(".forge-panel")).toContainText("feat/forge-e2e → main");
    await expect(app.locator(".forge-panel")).toContainText("abcdef0");

    // Pipeline aufklappen: Job, Bridge mit Child-Pipeline, fehlgeschlagener Job zeigt Trace
    await app.locator(".fp-pipeline-row").filter({ hasText: "#500" }).click();
    await expect(app.locator(".fp-job").filter({ hasText: "lint" })).toBeVisible();
    await expect(app.locator(".fp-job").filter({ hasText: "bridge:e2e" })).toContainText("Child-Pipeline #501");
    const verify = app.locator(".fp-job").filter({ hasText: "verify" });
    await verify.getByRole("button", { name: "Trace" }).click();
    await expect(app.locator(".fp-trace")).toContainText("FEHLER: erwartet 1, erhalten 2");
    await app.getByRole("button", { name: "schließen" }).click();

    // Befund: erst Vorschau (Mensch sieht, was gesendet wird), dann Versand an die Session
    await verify.getByRole("button", { name: "als Befund" }).click();
    await app.getByRole("button", { name: "Vorschau" }).click();
    await expect(app.locator(".fp-preview")).toContainText("verify");
    await app.getByRole("button", { name: "an Agenten senden" }).click();
    await hub.until(
      async () => (await hub.events(id)).some((e) => e.type === "user" && String((e.payload as { text?: string }).text ?? "").includes("verify")),
      "Befund erreicht die Session",
    );

    // K7: Verknüpfung kommt nach SIGKILL aus Journal + Snapshot zurück, Cache beweist nichts
    await hub.restart("SIGKILL");
    await openForge(app, hub, id);
    await expect(app.locator(".fp-mr-title")).toContainText("Forge E2E");

    await app.getByRole("button", { name: "lösen" }).click();
    await expect(app.getByPlaceholder(MR_URL)).toBeVisible();
  });

  test("CI-Befund als Quellenchip in den Composer (P43.5 T43.5-1)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "turn over");
    await openForge(app, hub, id);
    await app.getByPlaceholder(MR_URL).fill(MR_URL);
    await app.getByRole("button", { name: "verknüpfen" }).click();
    await expect(app.locator(".fp-mr-title")).toContainText("Forge E2E");
    await app.locator(".fp-pipeline-row").filter({ hasText: "#500" }).click();
    await app.locator(".fp-job").filter({ hasText: "verify" }).getByRole("button", { name: "als Befund" }).click();
    await app.getByRole("button", { name: "In den Composer" }).click();
    const chips = app.getByTestId("source-chips");
    await expect(chips.locator(".source-chip-label")).toContainText("CI-Befund · Pipeline #500");
    await expect(app.getByTestId("source-preview")).toContainText("<quellen>");
    expect((await hub.events(id)).some((e) => JSON.stringify(e.payload).includes("<quellen>"))).toBe(false);
  });
});
