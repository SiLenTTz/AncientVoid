import type { Page } from "@playwright/test";
import { test, expect, signIn } from "../support/fixtures.ts";

/**
 * EPIC-P57 T57.9 (AC-P57-7, AC-P57-8): Erststart der PWA — Einstieg im Leerzustand, Probe-Session,
 * einmaliges Erfolgssignal nach der ersten Freigabe, eigene Meldungen im Token-Gate.
 * Handy (412 px) läuft ohne Tag, der PC über @desktop.
 */
const guide = (page: Page) => page.getByRole("region", { name: "Erste Schritte" });

test.describe("Erststart: Einstieg im Leerzustand (AC-P57-7)", () => {
  test("ein frischer Hub zeigt den Einstieg mit Probe-Session-Knopf und Tutorial-Hinweis @desktop", async ({ app }) => {
    await expect(guide(app).getByRole("heading", { name: "Noch keine Sessions" })).toBeVisible();
    await expect(guide(app).getByRole("button", { name: "Probe-Session (dummy)" })).toBeVisible();
    await expect(guide(app)).toContainText("docs/tutorial-erste-schritte.md");
  });

  test("der Knopf legt eine dummy-Session an und öffnet sie @desktop", async ({ app, hub }) => {
    await guide(app).getByRole("button", { name: "Probe-Session (dummy)" }).click();
    await hub.until(async () => (await hub.sessions()).some((s) => s.adapter === "dummy"), "dummy-Session angelegt");
    expect((await hub.sessions()).map((s) => s.adapter)).toEqual(["dummy"]);
    await expect(guide(app)).toHaveCount(0);
  });

  test("das Archiv eines leeren Hubs zeigt weiter „nichts archiviert“, nicht den Einstieg", async ({ app }) => {
    await expect(guide(app)).toBeVisible();
    await app.getByRole("button", { name: /^Archiv/ }).click();
    await expect(app.getByText("nichts archiviert")).toBeVisible();
    await expect(guide(app)).toHaveCount(0);
  });

  test("ein Statusfilter ohne Treffer zeigt weiter den alten Leerzustand, nicht den Einstieg @desktop", async ({ app, hub }) => {
    await hub.createSession({ adapter: "dummy" });
    await app.evaluate(() => sessionStorage.setItem("ancientvoid.overviewFilter", "waiting"));
    await app.reload();
    await expect(app.getByText("keine Sessions — lege eine an")).toBeVisible();
    await expect(guide(app)).toHaveCount(0);
  });

  test("nach der ersten entschiedenen Freigabe erscheint einmal das Erfolgssignal und lässt sich schließen", async ({ app, hub }) => {
    // Der Einstieg „schärft“ das Gerät; erst danach zählt die erste Freigabe.
    await expect(guide(app)).toBeVisible();
    const id = await hub.createSession({ adapter: "claude", prompt: "Bitte WERKZEUG Erststart" });
    await hub.until(async () => (await hub.api<{ sessionId: string }[]>("/api/approvals?status=pending")).body.some((a) => a.sessionId === id), "Freigabe wartet");
    await app.locator(".session-card").filter({ hasText: "Erststart" }).locator(".card-decision").getByRole("button", { name: "Erlauben" }).click();
    const signal = app.getByRole("status").filter({ hasText: "Freigabe entschieden — Agent läuft weiter" });
    await expect(signal).toBeVisible();
    await app.reload();
    await expect(signal).toBeVisible();
    await signal.getByRole("button", { name: "Schließen" }).click();
    await expect(signal).toHaveCount(0);
    await app.reload();
    await expect(app.locator(".dashboard")).toBeVisible();
    await expect(signal).toHaveCount(0);
  });

  test("ein Gerät, das den Einstieg nie sah, bekommt kein Erfolgssignal", async ({ page: app, hub }) => {
    await signIn(app, hub);
    const id = await hub.createSession({ adapter: "claude", prompt: "Bitte WERKZEUG Altgerät" });
    await hub.until(async () => (await hub.api<{ sessionId: string }[]>("/api/approvals?status=pending")).body.some((a) => a.sessionId === id), "Freigabe wartet");
    await app.goto(hub.origin);
    await app.locator(".session-card").filter({ hasText: "Altgerät" }).locator(".card-decision").getByRole("button", { name: "Erlauben" }).click();
    await expect(app.getByText("Altgerät").first()).toBeVisible();
    await expect(app.getByText("Freigabe entschieden — Agent läuft weiter")).toHaveCount(0);
  });
});

test.describe("Erststart: Token-Gate nennt Ursache und nächsten Schritt (AC-P57-8)", () => {
  test("leeres Token: eigene Meldung, kein Hub-Aufruf @desktop", async ({ page, hub }) => {
    let calls = 0;
    await page.route("**/api/adapters", (route) => {
      calls += 1;
      void route.continue();
    });
    await page.goto(hub.origin);
    await expect(page.getByLabel("Device-Token")).toBeVisible();
    calls = 0; // der Start prüft einmal von selbst; zählt erst ab dem Klick
    await page.getByRole("button", { name: "Verbinden" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Bitte ein Device-Token eingeben" })).toContainText("hubctl token issue");
    expect(calls).toBe(0);
  });

  test("abgelehntes Token: eigene Meldung mit Weg zu einem neuen Token", async ({ page, hub }) => {
    await page.goto(hub.origin);
    await page.getByLabel("Device-Token").fill("falsches-token");
    await page.getByRole("button", { name: "Verbinden" }).click();
    const alert = page.getByRole("alert").filter({ hasText: "Der Hub hat das Token abgelehnt" });
    await expect(alert).toContainText("hubctl token issue");
    await expect(alert).not.toContainText("nicht erreichbar");
  });

  test("unerreichbarer Hub: eigene Meldung mit letzter Verbindung als Zeitstempel (K10), kein White-Screen @desktop", async ({ page, hub }) => {
    await page.addInitScript(() => {
      if (window.top === window) localStorage.setItem("ancientvoid.lastHubContact", "2026-11-12T12:15:00.000Z");
    });
    await page.route("**/api/adapters", (route) => route.abort("connectionrefused"));
    await page.goto(hub.origin);
    await page.getByLabel("Device-Token").fill(hub.token);
    await page.getByRole("button", { name: "Verbinden" }).click();
    const alert = page.getByRole("alert").filter({ hasText: "Der Hub ist nicht erreichbar" });
    await expect(alert).toContainText("scripts/hub.sh status");
    await expect(alert).toContainText(/Letzte Verbindung zu diesem Hub: 1[12]\.11\.2026/);
    await expect(alert).not.toContainText("abgelehnt");
    await expect(page.getByLabel("Device-Token")).toBeVisible();
  });
});
