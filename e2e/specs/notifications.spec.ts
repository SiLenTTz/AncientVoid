import { test, expect } from "../support/fixtures.ts";
import type { Page } from "@playwright/test";

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
    // EPIC-P51 T51.4 (löst T8.5 ab): am PC sitzt die Glocke im Fenstereck —
    // der Toast rückt ihr mit 56 px Vorhalte aus, statt in der Listenspalte zu liegen.
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(width - (box.x + box.width)).toBeGreaterThanOrEqual(48);
    // P50-Invariante nur auf der PC-Fläche: mit sichtbarem Toast scrollt das Fenster
    // nie (mobil drückt der Toast die Seite per T8.6 in den Fluss).
    if ((await app.locator(".split").count()) > 0) {
      expect(await app.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(await app.evaluate(() => window.innerHeight + 1));
    }
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
    await expect(app.locator(".topbar .status")).toHaveAttribute("data-status", "idle");
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

  test("Fehler und offene Fragen stehen angepinnt oben, der Rest darunter (Nutzerfund 2026-11-15)", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Bitte KONTINGENT" }); // Fehler
    await hub.createSession({ adapter: "claude", prompt: "Bitte FRAGE" }); // offene Frage, bleibt offen
    await hub.createSession({ adapter: "opencode", prompt: "Kurz" }); // Zug fertig
    await hub.until(
      async () => {
        const { body } = await hub.api<{ items: { kind: string; sessionId: string }[] }>("/api/notifications");
        const kinds = new Set(body.items.map((n) => n.kind));
        return kinds.has("provider.error") && kinds.has("tool.permission_requested") && kinds.has("session.turn_end");
      },
      "Fehler, Frage und fertiger Zug in der Glocke",
      30_000,
    );
    await app.getByRole("button", { name: /Benachrichtigungen/ }).click();
    const sections = app.locator(".notif-section");
    await expect(sections).toHaveCount(3);
    // Reihenfolge ist die Wichtigkeit: Fehler, offene Fragen, Rest.
    await expect(sections.nth(0).locator(".section-title")).toHaveText("Fehler");
    await expect(sections.nth(0).locator(".notif-item")).toContainText("Kontingent erschöpft");
    await expect(sections.nth(1).locator(".section-title")).toHaveText("Offene Fragen");
    await expect(sections.nth(1).locator(".notif-item")).toContainText("Rückfrage");
    await expect(sections.nth(2).locator(".section-title")).toHaveText("Übrige Meldungen");
    await expect(sections.nth(2).locator(".notif-item")).toContainText("Zug fertig");
    // Der Fehler liegt im DOM über der Frage und der Frage über dem Rest.
    const order = await app.evaluate(() =>
      [...document.querySelectorAll(".notif-item")].map((el) => el.textContent ?? ""),
    );
    const at = (text: string) => order.findIndex((t) => t.includes(text));
    expect(at("Kontingent erschöpft")).toBeLessThan(at("Rückfrage"));
    expect(at("Rückfrage")).toBeLessThan(at("Zug fertig"));
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

test.describe("Glocke am PC: Listenkopf wenn die Liste offen, Fenstereck wenn zu (EPIC-P64 T64.4 löst T51.4 ab) @desktop", () => {
  // Läuft in beiden Projekten als PC-Szenario (Muster: zoom-flaechen „Desktop-Fläche").
  test.use({ viewport: { width: 1440, height: 900 } });
  const CORNER_TOLERANCE = 14; // 8 px Anker + Subpixel-/Rundungstoleranz

  async function expectCornered(page: Page, zoomNote = "") {
    const { vw, vh } = await page.evaluate(() => ({ vw: window.innerWidth, vh: window.innerHeight }));
    const bell = (await page.locator(".notif-bell").boundingBox())!;
    expect(vw - (bell.x + bell.width), `Glocke rechts ${zoomNote}`).toBeLessThanOrEqual(CORNER_TOLERANCE);
    expect(bell.y, `Glocke oben ${zoomNote}`).toBeLessThanOrEqual(CORNER_TOLERANCE);
    await page.getByRole("button", { name: /Benachrichtigungen/ }).click();
    const panel = page.locator(".notif-panel");
    await expect(panel).toBeVisible();
    const box = (await panel.boundingBox())!;
    expect(vw - (box.x + box.width), `Panel rechts ${zoomNote}`).toBeLessThanOrEqual(CORNER_TOLERANCE);
    expect(box.x, `Panel links im Bild ${zoomNote}`).toBeGreaterThanOrEqual(-0.5);
    expect(box.y, `Panel oben im Bild ${zoomNote}`).toBeGreaterThanOrEqual(-0.5);
    expect(box.y + box.height, `Panel unten im Bild ${zoomNote}`).toBeLessThanOrEqual(vh + 0.5);
    await panel.locator(".notif-panel-head .btn").click();
    await expect(panel).toHaveCount(0);
  }

  /** T64.4: Fluss-Modus — Glocke liegt im Kopf der Listenspalte, größer als
   * die Umgebung (44 px), überdeckt nichts (kein fixed), Panel hängt gemessen
   * rechtsbündig unter ihr. Größen und Abstände gelten in CSS-px: mit
   * --ui-zoom (CSS `zoom`) skalieren gerenderte Boxen entsprechend. */
  async function expectInListHead(page: Page, note = "") {
    const zoom = await page.evaluate(() => Number(document.documentElement.style.getPropertyValue("--ui-zoom")) || 1);
    const bell = (await page.locator(".notif-bell").boundingBox())!;
    const column = (await page.locator(".split-list").boundingBox())!;
    const topbar = (await page.locator(".split-list .topbar").boundingBox())!;
    const vw = await page.evaluate(() => window.innerWidth);
    // In der Spalte, nicht am Fensterrand: deutlich Abstand zum rechten Rand.
    expect(bell.x + bell.width, `Glocke in der Spalte ${note}`).toBeLessThan(column.x + column.width + 0.5);
    expect(vw - (bell.x + bell.width), `Glocke nicht im Fenstereck ${note}`).toBeGreaterThan(40);
    // Im Fluss: die Topbar enthält sie (gleiche Zeile, innerhalb der Box).
    expect(bell.y).toBeGreaterThanOrEqual(topbar.y - 1);
    expect(bell.y + bell.height).toBeLessThanOrEqual(topbar.y + topbar.height + 1);
    // 44 px CSS — größer als die 36-px-Alte und jedes umliegende Icon der Topbar.
    expect(Math.abs(bell.width - 44 * zoom), `Glocke 44 px ${note}`).toBeLessThanOrEqual(1 + zoom);
    expect(Math.abs(bell.height - 44 * zoom), `Glocke 44 px hoch ${note}`).toBeLessThanOrEqual(1 + zoom);
    await page.getByRole("button", { name: /Benachrichtigungen/ }).click();
    const panel = page.locator(".notif-panel");
    await expect(panel).toBeVisible();
    const box = (await panel.boundingBox())!;
    // Panel hängt unter der Glocke, rechtsbündig zu ihr — nie mittig.
    expect(Math.abs(box.y - (bell.y + bell.height + 8 * zoom)), `Panel unter der Glocke ${note}`).toBeLessThanOrEqual(2 * zoom + 1);
    expect(Math.abs(box.x + box.width - (bell.x + bell.width)), `Panel rechtsbündig ${note}`).toBeLessThanOrEqual(2 * zoom + 1);
    const { vw: vw2, vh } = await page.evaluate(() => ({ vw: window.innerWidth, vh: window.innerHeight }));
    expect(box.x).toBeGreaterThanOrEqual(-0.5);
    expect(box.y).toBeGreaterThanOrEqual(-0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(vw2 + 0.5);
    expect(box.y + box.height).toBeLessThanOrEqual(vh + 0.5);
    await panel.locator(".notif-panel-head .btn").click();
    await expect(panel).toHaveCount(0);
  }

  test("Liste offen: Glocke im Listenkopf, Panel unter ihr — eingeklappt: Fenstereck", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Kurz" });
    await expect(app.locator(".split:not(.list-collapsed)")).toBeVisible();
    await expectInListHead(app, "(Liste offen)");
    await app.locator(".tile-list-toggle").click();
    await expect(app.locator(".split.list-collapsed")).toBeVisible();
    await expectCornered(app, "(Liste eingeklappt)");
    await app.locator(".tile-list-toggle").click();
    await expect(app.locator(".split:not(.list-collapsed)")).toBeVisible();
    await expectInListHead(app, "(Liste wieder offen)");
  });

  test("Listenkopf hält bei 130 % UI-Zoom (Zoom-Formel, P50)", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Kurz" });
    await app.evaluate(() => localStorage.setItem("ancientvoid.uiScale", "1.3"));
    await app.reload();
    await expect(app.locator(".split:not(.list-collapsed)")).toBeVisible();
    await expectInListHead(app, "(Zoom 130 %)");
  });
});
