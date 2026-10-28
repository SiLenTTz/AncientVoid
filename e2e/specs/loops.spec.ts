import { test, expect } from "../support/fixtures.ts";

/**
 * EPIC-P19 T19.6 (Gerüst): die Loop-Auswahl ist im Start-Formular erreichbar.
 * Beide Loops sind sichtbar, aber gesperrt, solange kein Connector angebunden
 * ist (T19.4/T19.5) — mit Grund, nie still verschwunden.
 */
test.describe("Loop / Dark Factory im Start-Formular", () => {
  test("aSPARK-Factory und securesight-factory stehen in der Auswahl, gesperrt und begründet @desktop", async ({ app, hub }) => {
    await app.goto(hub.origin);
    await app.getByRole("button", { name: "Neue Session" }).click();
    const loop = app.getByLabel("Loop", { exact: true });
    await expect(loop).toBeVisible();
    await expect(loop).toHaveValue("");
    await expect(loop.locator("option")).toHaveText(["kein Loop", "aSPARK-Factory (nicht verbunden)", "securesight-factory (nicht verbunden)"]);
    await expect(loop.locator("option[value=aspark-factory]")).toHaveAttribute("disabled", "");
    await expect(loop.locator("option[value=securesight-factory]")).toHaveAttribute("disabled", "");
    await expect(app.locator(".loop-reasons")).toContainText("aSPARK-Factory: Connector noch nicht angebunden");
    await expect(app.locator(".loop-reasons")).toContainText("securesight-factory: Connector noch nicht angebunden");
  });

  test("ohne Loop startet die Session wie bisher (AC-P19-5)", async ({ app, hub }) => {
    await app.goto(hub.origin);
    await app.getByRole("button", { name: "Neue Session" }).click();
    await expect(app.getByLabel("Loop", { exact: true })).toHaveValue("");
    await app.getByLabel("Adapter").selectOption("dummy");
    await app.locator("textarea").first().fill("ohne Loop");
    await app.getByRole("button", { name: /Starten|Session starten/ }).click();
    await expect(app).toHaveURL(/#\/sessions\//);
  });
});
