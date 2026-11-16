import { test, expect, sessionTab } from "../support/fixtures.ts";

/** Reiter „Befehle“: die Befehle des Repos nach Quelle gruppiert, je mit „Ausführen“ und Ausgabe. */
test.describe("Befehle", () => {
  test("zeigt Git-Befehle gruppiert, führt einen aus und zeigt die Ausgabe", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Befehle zeigen" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "Zug fertig");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Befehle");
    const panel = app.locator(".code-actions");
    await expect(panel.getByRole("heading", { name: "Befehle" })).toBeVisible();
    await expect(panel.locator(".action-group").first()).toBeVisible();
    await panel.getByRole("button", { name: "Git-Status ausführen" }).click();
    await expect(panel.getByRole("button", { name: /erfolgreich|fehlgeschlagen/ }).first()).toBeVisible();
    // Die Ausgabe klappt nach dem Start von selbst auf; der Status-Knopf klappt sie zu und wieder auf.
    await expect(panel.locator(".action-output")).toContainText("##");
    await panel.getByRole("button", { name: /erfolgreich|fehlgeschlagen/ }).first().click();
    await expect(panel.locator(".action-output")).toHaveCount(0);
    // Filter blendet andere Befehle aus.
    await panel.getByLabel("Befehle filtern").fill("Commits");
    await expect(panel.getByRole("button", { name: "Letzte Commits ausführen" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Git-Status ausführen" })).toHaveCount(0);
  });
});
