import { test, expect } from "../support/fixtures.ts";

/** Ja/Nein-Rückfragen als Buttons (QuickConfirm): endet die letzte
 * Assistant-Antwort auf „?“, stehen Ja/Nein über dem Composer — Klick
 * sendet den Prompt, ohne zu tippen. */
test.describe("Ja/Nein-Rückfrage ohne Tippen", () => {
  test("Buttons erscheinen bei Frage, Klick sendet, danach weg @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "JANEIN Änderung vorbereiten" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant" && String(e.payload.text).includes("committen?")), "Frage im Strom");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Chat" }).click();

    const confirm = app.locator(".quick-confirm");
    await expect(confirm).toBeVisible();
    await expect(app.locator(".tail-scroll").getByText("Soll ich die Änderung committen?")).toBeVisible();

    await confirm.getByRole("button", { name: "Ja" }).click();
    // Der Klick ging als eigener Prompt raus — als user-Event im Chat …
    await expect(app.locator(".tail-scroll .event.own").getByText("Ja", { exact: true })).toBeVisible();
    // … und der Stand-in antwortet diesmal ohne Frage: die Buttons verschwinden.
    await hub.until(async () => (await hub.events(id)).filter((e) => e.type === "assistant").length >= 2, "zweite Antwort");
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Ja · Claude/)).toBeVisible();
    await expect(confirm).toHaveCount(0);
  });

  test("Nein geht genauso — und tippt der Nutzer selbst, stehen die Buttons nicht im Weg", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "JANEIN Zweite Probe" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "erste Antwort");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Chat" }).click();
    await expect(app.locator(".quick-confirm")).toBeVisible();

    await app.getByPlaceholder("Antworten…").fill("e");
    await expect(app.locator(".quick-confirm")).toHaveCount(0);
    await app.getByPlaceholder("Antworten…").fill("");

    await app.locator(".quick-confirm").getByRole("button", { name: "Nein" }).click();
    await expect(app.locator(".tail-scroll .event.own").getByText("Nein", { exact: true })).toBeVisible();
    await hub.until(async () => (await hub.events(id)).filter((e) => e.type === "assistant").length >= 2, "zweite Antwort");
    await expect(app.locator(".quick-confirm")).toHaveCount(0);
  });
});
