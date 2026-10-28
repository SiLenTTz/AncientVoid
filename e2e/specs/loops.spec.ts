import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures.ts";

/**
 * EPIC-P19 T19.6: die Loop-Auswahl im Start-Formular. Echte Loops (aSPARK-Factory, securesight-factory) ohne
 * eingerichteten Connector stehen sichtbar, aber gesperrt und begründet da; der Fake-Loop des Testkits ist startbar.
 */
test.describe("Loop / Dark Factory im Start-Formular", () => {
  test("aSPARK-Factory und securesight-factory stehen in der Auswahl, gesperrt und begründet @desktop", async ({ app }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    const loop = app.getByLabel("Loop", { exact: true });
    await expect(loop).toBeVisible();
    await expect(loop).toHaveValue("");
    await expect(loop.locator("option")).toHaveText(["kein Loop", "aSPARK-Factory (nicht verbunden)", "securesight-factory (nicht verbunden)", "fake-loop"]);
    await expect(loop.locator("option[value=aspark-factory]")).toHaveAttribute("disabled", "");
    await expect(loop.locator("option[value=securesight-factory]")).toHaveAttribute("disabled", "");
    await expect(app.locator(".loop-reasons")).toContainText("aSPARK-Factory: nicht eingerichtet");
    await expect(app.locator(".loop-reasons")).toContainText("securesight-factory: nicht eingerichtet");
  });

  test("ohne Loop startet die Session wie bisher (AC-P19-5)", async ({ app }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await expect(app.getByLabel("Loop", { exact: true })).toHaveValue("");
    await app.getByLabel("Adapter").selectOption("opencode");
    await app.getByPlaceholder("Refactore den Auth-Flow…").fill("ohne Loop");
    await app.getByRole("button", { name: "Starten" }).click();
    await expect(app).toHaveURL(/#\/sessions\//);
  });

  test("ein Loop: Felder kommen vom Loop, die riskante Betriebsart braucht ein Häkchen, dann läuft er als Session", async ({ app, hub }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Loop", { exact: true }).selectOption("fake-loop");
    // Adapter/Modell/Modus entscheidet der Loop — die Felder verschwinden mit Begründung.
    await expect(app.getByLabel("Adapter")).toHaveCount(0);
    await expect(app.getByText("Adapter, Modell und Modus bestimmt der Loop selbst.")).toBeVisible();
    // Betriebsart: nie die riskante als Vorgabe.
    const betriebsart = app.getByLabel("Betriebsart");
    await expect(betriebsart).toHaveValue("ruhig");
    const start = app.getByRole("button", { name: "Starten" });
    // Pflichtoption fehlt.
    await expect(start).toBeDisabled();
    await expect(app.locator(".loop-block")).toHaveText("Line fehlt");
    await app.getByLabel("Line").fill("alpha");
    await expect(start).toBeEnabled();
    // Riskant: ohne Häkchen kein Start.
    await betriebsart.selectOption("scharf");
    await expect(start).toBeDisabled();
    await expect(app.locator(".loop-block")).toContainText("braucht deine Bestätigung");
    await app.getByLabel("Außenwirkung bestätigen").check();
    await expect(start).toBeEnabled();
    await start.click();

    await expect(app).toHaveURL(/#\/sessions\//);
    const [record] = await hub.sessions();
    expect(record?.adapter).toBe("loop:fake-loop");
    await hub.until(async () => (await hub.events(record!.id)).some((e) => (e.payload as { kind?: string }).kind === "loop.info"), "loop.info");
    const info = (await hub.events(record!.id)).find((e) => (e.payload as { kind?: string }).kind === "loop.info");
    expect(info?.payload).toMatchObject({ line: "alpha", mode: "scharf" });
  });

  const startLoop = async (app: Page, goal = "") => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Loop", { exact: true }).selectOption("fake-loop");
    await app.getByLabel("Line").fill("alpha");
    if (goal) await app.getByPlaceholder("Refactore den Auth-Flow…").fill(goal);
    await app.getByRole("button", { name: "Starten" }).click();
    await expect(app).toHaveURL(/#\/sessions\//);
  };

  test("Kopf-Abzeichen und Panel zeigen Betriebsart, Fortschritt und Gate; Pause und Betriebsart gehen an den Loop (T19.6)", async ({ app }) => {
    await startLoop(app);
    await expect(app.locator(".session-top-meta .loop-badge")).toHaveText("Loop · fake-loop · ruhig");
    await expect(app.locator(".loop-panel")).toContainText("1 von 3 Aufgaben · bauen");
    await expect(app.locator(".loop-gate")).toContainText("policy: bestanden");
    await expect(app.locator(".loop-bar")).toHaveAttribute("aria-valuenow", "33");

    await app.getByRole("button", { name: "Pausieren" }).click();
    await expect(app.getByRole("button", { name: "Weiter" })).toBeVisible();
    await expect(app.locator(".session-top-meta .loop-badge")).toHaveText("Loop · fake-loop · ruhig · pausiert");
    await app.getByRole("button", { name: "Weiter" }).click();
    await expect(app.getByRole("button", { name: "Pausieren" })).toBeVisible();

    // Betriebsart mit Außenwirkung: ohne Bestätigung bleibt sie, wie sie war.
    app.once("dialog", (d) => void d.dismiss());
    await app.getByLabel("Betriebsart des Loops").selectOption("scharf");
    await expect(app.locator(".session-top-meta .loop-badge")).toHaveText("Loop · fake-loop · ruhig");
    app.once("dialog", (d) => void d.accept());
    await app.getByLabel("Betriebsart des Loops").selectOption("scharf");
    await expect(app.locator(".session-top-meta .loop-badge")).toHaveText("Loop · fake-loop · scharf");
  });

  test("ein gestörter Loop fällt sofort auf: Abzeichen und Warnung mit Grund (T19.6)", async ({ app }) => {
    await startLoop(app, "FEHLER");
    await expect(app.locator(".loop-alert.bad")).toContainText("Loop gestört: offline");
    await expect(app.locator(".session-top-meta .loop-badge")).toHaveText("Loop · fake-loop · ruhig · gestört");
  });
});
