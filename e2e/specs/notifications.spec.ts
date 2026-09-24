import { test, expect } from "../support/fixtures.ts";

test.describe("Fehler und Benachrichtigungen (ADR-0015)", () => {
  test("ein erschöpftes Kontingent erscheint als rote Karte oben rechts und im Chat @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Bitte KONTINGENT" });
    const toast = app.locator(".toast.error").filter({ hasText: "Kontingent erschöpft (5 h)" });
    await expect(toast).toBeVisible();
    await expect(toast).toContainText("wieder frei ab 2026-09-23 15:00:00");
    const box = (await toast.boundingBox())!;
    const width = app.viewportSize()!.width;
    expect(box.y).toBeLessThan(160);
    // T8.5: on the desktop split the messages live in the list column.
    if ((await app.locator(".split").count()) > 0) expect(box.x + box.width).toBeLessThanOrEqual((await app.locator(".split-list").boundingBox())!.width + 40);
    else expect(box.x + box.width).toBeGreaterThan(width * 0.6);
    await expect(app.locator(".toast.error"), "no second toast for the process exit").toHaveCount(1);

    await toast.locator(".toast-body").click();
    await expect(app).toHaveURL(new RegExp(`#/sessions/${id}`));
    await app.getByRole("button", { name: "Chat" }).click();
    await expect(app.locator(".event.provider-error")).toContainText("opencode: Kontingent erschöpft (5 h)");
  });

  test("nach einem Fehler geht es mit dem nächsten Prompt weiter", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Bitte KONTINGENT" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.payload.kind === "provider.error"), "provider error");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Chat" }).click();
    await app.getByPlaceholder("Antworten…").fill("Jetzt wieder");
    await app.getByRole("button", { name: /^(Senden|Weiter)$/ }).click();
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Jetzt wieder/)).toBeVisible();
    await expect(app.locator(".topbar .pill")).toHaveAttribute("data-status", "idle");
  });

  test("ein Serverfehler ohne Ursache wird ehrlich erklärt", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Bitte SERVERFEHLER" });
    const toast = app.locator(".toast.error").filter({ hasText: "Serverfehler beim Provider" });
    await expect(toast).toContainText("keine Ursache");
    await expect(toast).toContainText("err_9508ce50");
  });

  test("ein fertiger Zug landet in der Glocke — ohne Meldung über dem Inhalt (T8.6)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Kurz" });
    await expect(app.getByRole("button", { name: "Benachrichtigungen (1 neu)" })).toBeVisible();
    await expect(app.locator(".toast")).toHaveCount(0);
    await app.getByRole("button", { name: "Benachrichtigungen (1 neu)" }).click();
    const item = app.locator(".notif-item").filter({ hasText: "alpha · Zug fertig" });
    await expect(item).toBeVisible();
    await expect(app.getByRole("button", { name: "Benachrichtigungen", exact: true })).toBeVisible();
    await item.click();
    await expect(app).toHaveURL(new RegExp(`#/sessions/${id}`));
    await app.reload();
    await expect(app.getByRole("button", { name: "Benachrichtigungen", exact: true })).toBeVisible();
    await expect(app.locator(".toast")).toHaveCount(0);
  });

  test("Hub weg und wieder da wird gemeldet", async ({ app, hub }) => {
    await hub.kill("SIGKILL");
    await expect(app.locator(".toast.warning").filter({ hasText: "Hub nicht erreichbar" })).toBeVisible({ timeout: 15_000 });
    await hub.restart();
    await expect(app.locator(".toast.success").filter({ hasText: "Verbindung zum Hub wieder da" })).toBeVisible({ timeout: 15_000 });
  });
});
