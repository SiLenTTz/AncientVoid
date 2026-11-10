import { test, expect } from "../support/fixtures.ts";

test.describe("Fehler und Benachrichtigungen (ADR-0015)", () => {
  test("ein erschöpftes Kontingent erscheint als rote Karte oben rechts und im Chat @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Bitte KONTINGENT" });
    const toast = app.locator(".toast.error").filter({ hasText: "Kontingent erschöpft (5 h)" });
    await expect(toast).toBeVisible();
    await expect(toast).toContainText("wieder frei ab 2026-09-23 15:00:00");
    const box = (await toast.boundingBox())!;
    // Nach clearDeviceMetricsOverride kennt Playwright die Fläche nicht (T16.6).
    const width = app.viewportSize()?.width ?? (await app.evaluate(() => window.innerWidth));
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

test.describe("Benachrichtigungen bei UI-Skalierung (Nutzerfund 2026-10-30)", () => {
  // Telefonbreite: erst hier fällt die ungeteilte 100vw-Breite aus dem Bild.
  test.use({ viewport: { width: 390, height: 844 } });

  test("das Panel bleibt bei 140 % Skalierung im Bildschirm und die ✕ bleibt erreichbar", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Kurz" });
    await expect(app.getByRole("button", { name: /Benachrichtigungen/ })).toBeVisible();
    await app.evaluate(() => localStorage.setItem("ancientvoid.uiScale", "1.4"));
    await app.reload();
    await app.getByRole("button", { name: /Benachrichtigungen/ }).click();
    const panel = app.locator(".notif-panel");
    await expect(panel).toBeVisible();
    const vw = await app.evaluate(() => window.innerWidth);
    const box = (await panel.boundingBox())!;
    // zoom skaliert die gerenderte Größe — beide Kanten müssen im Viewport bleiben.
    expect(box.x).toBeGreaterThanOrEqual(-0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(vw + 0.5);
    const close = (await panel.locator(".notif-panel-head .btn").boundingBox())!;
    expect(close.x).toBeGreaterThanOrEqual(-0.5);
    expect(close.x + close.width).toBeLessThanOrEqual(vw + 0.5);
  });

  for (const scale of ["1", "1.2", "1.6"]) {
    test(`Panel liegt bei ${Math.round(Number(scale) * 100)} % vollständig im Bild (alle vier Kanten)`, async ({ app, hub }) => {
      await hub.createSession({ adapter: "opencode", prompt: "Kurz" });
      await expect(app.getByRole("button", { name: /Benachrichtigungen/ })).toBeVisible();
      await app.evaluate((v) => localStorage.setItem("ancientvoid.uiScale", v), scale);
      await app.reload();
      await app.getByRole("button", { name: /Benachrichtigungen/ }).click();
      const panel = app.locator(".notif-panel");
      await expect(panel).toBeVisible();
      const { vw, vh } = await app.evaluate(() => ({ vw: window.innerWidth, vh: window.innerHeight }));
      for (const box of [(await panel.boundingBox())!, (await panel.locator(".notif-panel-head .btn").boundingBox())!]) {
        expect(box.x).toBeGreaterThanOrEqual(-0.5);
        expect(box.y).toBeGreaterThanOrEqual(-0.5);
        expect(box.x + box.width).toBeLessThanOrEqual(vw + 0.5);
        expect(box.y + box.height).toBeLessThanOrEqual(vh + 0.5);
      }
    });

    test(`Meldung oben überdeckt die Glocke nicht bei ${Math.round(Number(scale) * 100)} %`, async ({ app, hub }) => {
      await app.evaluate((v) => localStorage.setItem("ancientvoid.uiScale", v), scale);
      await app.reload();
      await hub.createSession({ adapter: "opencode", prompt: "Bitte KONTINGENT" });
      const toast = app.locator(".toast.error").first();
      await expect(toast).toBeVisible();
      const close = (await toast.locator(".toast-close").boundingBox())!;
      // Die Glocke liegt fest oben rechts — die ✕ der Meldung darf sie nicht berühren.
      const box = (await app.locator(".notif-bell").boundingBox())!;
      const overlaps = close.x < box.x + box.width && close.x + close.width > box.x && close.y < box.y + box.height && close.y + close.height > box.y;
      expect(overlaps, `✕ ${JSON.stringify(close)} vs Glocke ${JSON.stringify(box)}`).toBe(false);
    });
  }
});
