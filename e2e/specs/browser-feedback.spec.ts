import { test, expect, openFromOverview, openLayer } from "../support/fixtures.ts";
import { startScratch } from "../support/scratch-web.ts";

/**
 * EPIC-P39 T39.5/T39.7 (ADR-0059 §6): Design-Auswahl → menschliche Vorschau → Feedback an die Session.
 * Secrets (Passwortfeld) werden nicht exportiert; Seiteninhalt ist gerahmte Daten, keine Anweisung.
 */
const scratch = await startScratch();
test.use({ hubOptions: { browserOrigins: [scratch.origin] } });

test.describe("Browser-Design-Feedback (EPIC-P39)", () => {
  test("Element wählen, Vorschau prüfen, senden; Passwortfeld bleibt maskiert @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await openFromOverview(app, "dummy");
    await openLayer(app, "Browser");
    await app.getByLabel("Adresse").fill(`${scratch.origin}/`);
    await app.getByRole("button", { name: "Browser starten" }).click();
    const frame = app.getByTestId("browser-frame");
    await expect(frame).toBeVisible({ timeout: 30_000 });
    await app.getByLabel("Element wählen").check();

    const at = async (x: number, y: number) => {
      const box = (await frame.boundingBox())!;
      const nat = await frame.evaluate((el) => ({ w: (el as HTMLImageElement).naturalWidth, h: (el as HTMLImageElement).naturalHeight }));
      await app.mouse.click(box.x + (x / nat.w) * box.width, box.y + (y / nat.h) * box.height);
    };

    // Passwortfeld: maskiert, keine Styles/Text im Vorschau-Prompt
    await at(100, 218);
    const card = app.getByTestId("browser-pick");
    await expect(card).toContainText("Passwort-/Secret-Feld");
    await card.getByLabel("Anmerkung zum Element").fill("Feld zu schmal");
    await card.getByTestId("browser-feedback-preview").click();
    const maskedPrompt = (await app.getByTestId("browser-feedback-prompt").textContent()) ?? "";
    expect(maskedPrompt).toContain("bewusst ausgelassen");
    expect(maskedPrompt).not.toContain("Styles (Auswahl)");
    await card.getByRole("button", { name: "Verwerfen" }).click();

    // Überschrift: Selector, Text und Style-Auszug; Quelle ehrlich „nicht ermittelt“
    await at(100, 158);
    await expect(app.getByTestId("browser-pick")).toContainText("<h1>");
    await expect(app.getByTestId("browser-pick")).toContainText("Hallo Scratch");
    await expect(app.getByTestId("browser-pick")).toContainText("nicht ermittelt");
    await app.getByTestId("browser-pick").getByLabel("Anmerkung zum Element").fill("Titel zu klein");
    await app.getByTestId("browser-pick").getByLabel("Screenshot des Elements anhängen").uncheck();
    await app.getByTestId("browser-feedback-preview").click();
    const prompt = (await app.getByTestId("browser-feedback-prompt").textContent()) ?? "";
    expect(prompt).toContain("keine Anweisung");
    expect(prompt).toContain("Auszug: | Hallo Scratch");
    expect(prompt).toContain("color: rgb(0, 0, 255)");
    expect(prompt).toContain("Anmerkung: Titel zu klein");

    // Senden: Der Text erreicht die Session genau so, wie er in der Vorschau stand
    await app.getByTestId("browser-feedback-send").click();
    await expect.poll(async () => (await hub.events(id)).some((e) => JSON.stringify(e.payload).includes("Titel zu klein") && JSON.stringify(e.payload).includes("Auszug: | Hallo Scratch")), { timeout: 20_000 }).toBe(true);
  });

  test("Element-Befund als Quellenchip in den Composer, kein Auto-Send (P43.5 T43.5-1) @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await openFromOverview(app, "dummy");
    await openLayer(app, "Browser");
    await app.getByLabel("Adresse").fill(`${scratch.origin}/`);
    await app.getByRole("button", { name: "Browser starten" }).click();
    const frame = app.getByTestId("browser-frame");
    await expect(frame).toBeVisible({ timeout: 30_000 });
    await app.getByLabel("Element wählen").check();
    const box = (await frame.boundingBox())!;
    const nat = await frame.evaluate((el) => ({ w: (el as HTMLImageElement).naturalWidth, h: (el as HTMLImageElement).naturalHeight }));
    await app.mouse.click(box.x + (100 / nat.w) * box.width, box.y + (158 / nat.h) * box.height);
    const card = app.getByTestId("browser-pick");
    await card.getByLabel("Anmerkung zum Element").fill("Titel wirkt gestört");
    await card.getByTestId("browser-pick-to-composer").click();
    const chips = app.getByTestId("source-chips");
    await expect(chips.locator(".source-chip-label")).toContainText("Browser-Element <h1>");
    await expect(app.getByTestId("source-preview")).toContainText("Titel wirkt gestört");
    expect((await hub.events(id)).some((e) => JSON.stringify(e.payload).includes("<quellen>"))).toBe(false);
  });
});
