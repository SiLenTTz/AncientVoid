import { test, expect } from "../support/fixtures.ts";

test.describe("Kleine Hilfen (T8.6)", () => {
  test("neu seit dem letzten Besuch: Marke auf der Karte, Trenner und Sprung in der Session", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Erster Zug" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "idle");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Chat" }).click();
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Erster Zug/)).toBeVisible();
    await app.waitForTimeout(1700); // read cursor is written after 1.5 s
    await app.getByLabel("Zur Übersicht").click();
    await expect(app.locator(".session-card .new-badge")).toHaveCount(0);

    await hub.api(`/api/sessions/${id}/steer`, { body: { kind: "prompt", text: "Zweiter Zug vom PC" } });
    await expect(app.locator(".session-card .new-badge")).toHaveText("neu", { timeout: 10_000 });
    await app.locator(".session-open").click();
    await expect(app.locator(".new-divider")).toHaveText("Neu seit deinem letzten Besuch");
    await expect(app.getByRole("button", { name: /neu seit deinem letzten Besuch/ })).toBeVisible();
    // The divider sits right before the new turn.
    const after = app.locator(".new-divider + .event");
    await expect(after).toBeVisible();
    await app.waitForTimeout(1700);
    await app.getByLabel("Zur Übersicht").click();
    await expect(app.locator(".session-card .new-badge")).toHaveCount(0);
  });

  test("Sprachbefehle zeigen nur, was wirklich geht, und fragen vor dem Ausführen", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByLabel("Weitere Aktionen").click();
    await app.locator(".session-menu").getByRole("button", { name: "Sprachbefehl" }).click();
    await expect(app.locator(".voice-example-chip")).toHaveText(["„Stopp\"", "„Budget auf 5 Dollar\""]);
    await app.locator(".voice-example-chip").first().click();
    await expect(app.getByRole("button", { name: "Bestätigen" })).toBeVisible();
    expect((await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status).not.toBe("stopped");
  });

  test("eine Antwort, die nicht ankam, geht mit „Erneut versuchen“ genau einmal", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "idle");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.route("**/steer", (route) => route.abort("connectionreset"), { times: 1 });
    await app.getByPlaceholder("Antworten…").fill("Nochmal bitte");
    await app.getByRole("button", { name: "Senden" }).click();
    const retry = app.getByRole("button", { name: "Erneut versuchen" });
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Nochmal bitte/)).toBeVisible();
    expect((await hub.events(id)).filter((e) => e.type === "user")).toHaveLength(2);
  });
});
