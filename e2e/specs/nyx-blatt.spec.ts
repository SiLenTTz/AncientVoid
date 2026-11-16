import { test, expect } from "../support/fixtures.ts";
import { phone } from "../support/phone.ts";

/**
 * EPIC-P43 T43.8: die kleine Nyx in der Kopfzeile zeigt den Gesamtzustand; ihr Blatt sammelt alle wartenden
 * Freigaben und Fragen über alle Sessions. Antworten laufen über denselben `decide`-Weg wie Start und Session.
 */
test.describe("Nyx-Blatt (EPIC-P43 T43.8)", () => {
  test("ruhig ohne Arbeit; eine Freigabe entscheidet ein Tipp im Blatt (AC-P43-2) @tablet @desktop", async ({ app, hub }) => {
    const nyx = app.locator(".topbar .nyx-button");
    await expect(nyx).toHaveAttribute("data-nyx", "quiet");
    await expect(nyx).toHaveAccessibleName("Nyx: Alles ruhig.");

    const id = await hub.createSession({ adapter: "claude", prompt: "Bitte WERKZEUG ausführen" });
    await expect(nyx).toHaveAttribute("data-nyx", "approval", { timeout: 15_000 });
    await expect(nyx.locator(".nyx-count")).toHaveText("1");
    await nyx.click();
    const sheet = app.getByRole("dialog", { name: "Nyx" });
    await expect(sheet.locator(".nyx-sentence")).toHaveText("Eine Freigabe wartet auf dich.");
    await sheet.getByRole("button", { name: "Erlauben" }).click();
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant" && String(e.payload.text).includes("Ausgabe hallo-ancientvoid")), "Werkzeug lief");
    await expect(sheet.getByText("Nichts wartet auf dich.")).toBeVisible();
    await app.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
  });

  test("eine Auswahlfrage steht mit der empfohlenen Option vorgewählt; die Antwort erreicht den Agenten (AC-P43-10)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "Bitte FRAGE EMPFOHLEN" });
    const nyx = app.locator(".topbar .nyx-button");
    await expect(nyx).toHaveAttribute("data-nyx", "question", { timeout: 15_000 });
    await nyx.click();
    const sheet = app.getByRole("dialog", { name: "Nyx" });
    await expect(sheet.locator(".nyx-sentence")).toHaveText("Ein Agent hat eine Frage.");
    const item = sheet.locator(".nyx-item");
    await expect(item.locator(".question-text")).toHaveText("Welche Farbe soll das Logo haben?");
    // Vorgewählt, aber nicht gesendet: erst der Tipp auf „Antworten“ geht zum Hub.
    await expect(item.getByRole("button", { name: "Antworten" })).toBeEnabled();
    expect((await hub.events(id)).some((e) => e.type === "assistant" && String(e.payload.text).includes("Gewählt"))).toBe(false);
    await item.getByRole("button", { name: "Antworten" }).click();
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant" && String(e.payload.text).includes("Gewählt: Grün (Empfohlen)")), "Antwort beim Agenten");
    await expect(sheet.getByText("Nichts wartet auf dich.")).toBeVisible();
  });

  test("eine Ja/Nein-Frage beantwortet ein Tipp; der Sessionname führt in die Session", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "Bitte BESTAETIGEN" });
    const nyx = app.locator(".topbar .nyx-button");
    await expect(nyx).toHaveAttribute("data-nyx", "question", { timeout: 15_000 });
    await nyx.click();
    const item = app.getByRole("dialog", { name: "Nyx" }).locator(".nyx-item");
    await expect(item.locator(".question-text")).toHaveText("Soll ich weitermachen?");
    // Die Taste trägt ihre Ziffer („1 Ja“) — der Tipp antwortet sofort, ohne „Antworten“.
    await item.getByRole("button", { name: /^\d Ja$/ }).click();
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant" && String(e.payload.text).includes("Gewählt: Ja")), "Ja beim Agenten");

    // Das Blatt bleibt offen und lädt nach: eine zweite Frage erscheint, ihr Sessionname öffnet die Session.
    const other = await hub.createSession({ adapter: "claude", prompt: "Bitte FRAGE" });
    await app.getByRole("dialog", { name: "Nyx" }).locator(".nyx-item-session", { hasText: "FRAGE" }).click({ timeout: 15_000 });
    await expect(app.getByRole("dialog", { name: "Nyx" })).toHaveCount(0);
    await expect(app).toHaveURL(new RegExp(`#/sessions/${other}`));
  });

  test("Freigaben mit Begründung oder Passkey verweisen in die Session", async ({ app }) => {
    const pending = [
      { id: "a1", sessionId: "s1", class: "write", action: "x", summary: "Datei schreiben", status: "pending", createdAt: new Date().toISOString(), timeoutAt: new Date(Date.now() + 600_000).toISOString(), reasonRequired: true },
    ];
    await app.route(/\/api\/approvals\?status=pending/, (route) => route.fulfill({ json: pending }));
    await app.reload();
    const nyx = app.locator(".topbar .nyx-button");
    await expect(nyx).toHaveAttribute("data-nyx", "approval");
    await nyx.click();
    const item = app.getByRole("dialog", { name: "Nyx" }).locator(".nyx-item");
    await expect(item).toContainText("Braucht eine Begründung.");
    await expect(item.getByRole("button", { name: "Erlauben" })).toHaveCount(0);
    await item.getByRole("button", { name: "In der Session entscheiden" }).click();
    await expect(app).toHaveURL(/#\/sessions\/s1/);
  });

});

test.describe("Nyx-Blatt als eigenes Fenster (EPIC-P43 T43.8, ADR-0068)", () => {
  // Fenster gibt es erst ab 1280 px — das Handy- und Tablet-Projekt prüft mit erzwungener Breite.
  test.use({ viewport: { width: 1440, height: 900 } });

  test("am PC lässt sich das Blatt herauslösen @desktop", async ({ app, hub, context }) => {
    test.skip(phone.active, "eigene Fenster gibt es nur am PC; das Handy hat keine Fenster");
    await hub.createSession({ adapter: "claude", prompt: "Bitte WERKZEUG ausführen" });
    const nyx = app.locator(".topbar .nyx-button");
    await expect(nyx).toHaveAttribute("data-nyx", "approval", { timeout: 15_000 });
    await nyx.click();
    const popupP = context.waitForEvent("page");
    await app.getByRole("dialog", { name: "Nyx" }).getByRole("button", { name: "Nyx in eigenem Fenster öffnen" }).click();
    const popup = await popupP;
    await expect(popup.locator(".nyx-item")).toHaveCount(1);
    await expect(popup.locator(".dock")).toHaveCount(0);
    await expect(app.getByRole("dialog", { name: "Nyx" })).toHaveCount(0);
    await popup.locator(".nyx-item").getByRole("button", { name: "Erlauben" }).click();
    await expect(popup.getByText("Nichts wartet auf dich.")).toBeVisible();
    await popup.close();
  });
});
