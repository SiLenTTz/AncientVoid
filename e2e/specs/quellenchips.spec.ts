import { test, expect } from "../support/fixtures.ts";

/**
 * EPIC-P43.5 T43.5-1: Quellenchips — Code-Befunde aus dem Datei-Tab wandern
 * als sichtbare Chips in den Composer; Vorschau zeigt exakt den Block, der
 * mitgesendet wird; nichts geht automatisch raus (K3/K5).
 */
test.describe("Quellenchips im Composer (EPIC-P43.5 T43.5-1)", () => {
  test("Datei-Befund als Quelle: Chip + Vorschau, Senden hängt den Block an, danach verbraucht", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Kurz" });
    await app.goto(`${hub.origin}/#/sessions/${id}/datei/README.md`);
    await expect(app.getByTestId("file-text")).toBeVisible();

    // Zwei Zeilen als Befund in den Korb, mit Anmerkung.
    await app.getByRole("button", { name: "Zeile 2 auswählen" }).click();
    await app.getByRole("button", { name: "Zeile 3 auswählen" }).click({ modifiers: ["Shift"] });
    await app.getByTestId("file-feedback-add").click();
    await app.getByLabel("Anmerkung zu README.md Zeile 2").fill("Hier ist der Handoff erklärt");

    // Vor dem Übernehmen: kein ungesendeter Block im Composer.
    await expect(app.getByTestId("source-chips")).toHaveCount(0);
    await app.getByTestId("feedback-to-composer").click();
    await expect(app.getByTestId("feedback-panel")).toHaveCount(0); // Korb gewandert, nicht doppelt

    // Chip + Mitgesendet-Vorschau zeigen exakt den Block — noch ist nichts gesendet.
    const chips = app.getByTestId("source-chips");
    await expect(chips.locator(".source-chip-label")).toContainText("README.md:2–3");
    await expect(app.getByTestId("source-preview")).toContainText("<quellen>");
    await expect(app.getByTestId("source-preview")).toContainText("[1] Code — README.md:2–3");
    await expect(app.getByTestId("source-preview")).toContainText("Hier ist der Handoff erklärt");
    await expect(app.getByTestId("source-preview")).toContainText("Das Handbuch beschreibt den Handoff");
    const before = await hub.events(id);
    expect(before.some((e) => (e.payload as { text?: string }).text?.includes("<quellen>"))).toBe(false);

    // Bewusstes Absenden: der Block hängt am Prompt (K5: Gesamttext klein).
    await app.getByPlaceholder("Antworten…").fill("Bitte die markierte Stelle beachten");
    await app.getByRole("button", { name: /^(Senden|Weiter)$/ }).click();
    await hub.until(async () => (await hub.events(id)).some((e) => (e.payload as { text?: string }).text?.includes("<quellen>")), "Quellenblock im Prompt");
    const sent = (await hub.events(id)).findLast((e) => typeof (e.payload as { text?: string }).text === "string")!;
    const text = (sent.payload as { text: string }).text;
    expect(text).toContain("Bitte die markierte Stelle beachten");
    expect(text).toContain("[1] Code — README.md:2–3");
    expect(text.length).toBeLessThan(4096); // K5
    await expect(chips).toHaveCount(0); // verbraucht
    await expect(app.getByTestId("source-preview")).toHaveCount(0);
  });

  test("Quelle entfernen: kein Block im Prompt, kein Ghost-Marker", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Kurz" });
    await app.goto(`${hub.origin}/#/sessions/${id}/datei/README.md`);
    await app.getByRole("button", { name: "Zeile 2 auswählen" }).click();
    await app.getByTestId("file-feedback-add").click();
    await app.getByTestId("feedback-to-composer").click();
    await expect(app.getByTestId("source-chips")).toBeVisible();
    await app.getByRole("button", { name: "Quelle entfernen: README.md:2" }).click();
    await expect(app.getByTestId("source-chips")).toHaveCount(0);
    await app.getByPlaceholder("Antworten…").fill("Ohne Quelle");
    await app.getByRole("button", { name: /^(Senden|Weiter)$/ }).click();
    await hub.until(async () => (await hub.events(id)).some((e) => (e.payload as { text?: string }).text === "Ohne Quelle"), "Text gesendet");
    const latest = (await hub.events(id)).findLast((e) => typeof (e.payload as { text?: string }).text === "string")!;
    expect((latest.payload as { text: string }).text).not.toContain("<quellen>");
  });
});

test("Abgelehntes Senden verliert die ausgewählten Quellen nicht @desktop", async ({ app, hub }) => {
  const id = await hub.createSession({ adapter: "codex", prompt: "Kurz" });
  await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "initial turn ended");
  await app.goto(`${hub.origin}/#/sessions/${id}/datei/README.md`);
  await app.getByRole("button", { name: "Zeile 2 auswählen" }).click();
  await app.getByTestId("file-feedback-add").focus();
  await app.getByTestId("file-feedback-add").press("Enter");
  await app.getByTestId("feedback-to-composer").click();
  const show = app.getByRole("button", { name: "Steuerung einblenden", exact: true });
  if (await show.isVisible()) await show.click();
  await app.getByPlaceholder("Antworten…").fill("REJECT_START");
  await app.getByRole("button", { name: /^(Senden|Weiter)$/ }).click();
  await expect(app.getByTestId("source-chips")).toBeVisible();
  await expect(app.getByPlaceholder("Antworten…")).toHaveValue("REJECT_START");
  await expect(app.locator(".reply-error")).toBeVisible();
});
