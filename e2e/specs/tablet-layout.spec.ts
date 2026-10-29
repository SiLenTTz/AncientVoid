import { test, expect } from "../support/fixtures.ts";

/**
 * Tablet-Profil (Zustands-Scan 2026-10-29, Empfehlung 5): zwischen dem
 * mobile-Projekt (Pixel 7, 412 px) und desktop (Desktop Chrome, Maus) tested
 * kein Projekt die Tablet-Fläche. Portrait (800 px) muss das Phone-Layout mit
 * Dock halten; Querformat (Touch, 1280 px) schaltet in den Split-/Kachel-
 * Arbeitsplatz aus T8.5 (AC-P8-6) — live, ohne Neuladen (main.tsx useWide).
 * K2/K10. Läuft zusätzlich im mobile-Projekt (dort mit erzwungenen Viewports,
 * ebenso wie layout-desktop.spec.ts auf 1440 px läuft).
 */
test.describe("Tablet", () => {
  test("Portrait (800 px): Phone-Layout — Dock per Tap, kein Split @tablet", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Tablet-Aufgabe" });
    await expect(app.locator(".split")).toHaveCount(0);
    await expect(app.locator(".tile")).toHaveCount(0);
    const dock = app.locator(".dock-stack");
    await expect(dock).toBeVisible();
    await expect(dock.locator(".dock-item").first()).toBeVisible();
    await app.locator(".session-card").filter({ hasText: "Tablet-Aufgabe" }).locator(".session-open").click();
    await expect(app.locator(".session-top-title")).toHaveText("Tablet-Aufgabe");
  });

  test("Querformat (1280 px, Touch): Split-Arbeitsplatz, Karte per Tap öffnen @tablet", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Erste Aufgabe" });
    await app.setViewportSize({ width: 1280, height: 800 });
    await app.goto(hub.origin);
    await expect(app.locator(".split")).toBeVisible();
    await expect(app.locator(".tile-empty")).toContainText("Session links wählen");
    await app.locator(".split-list .session-card").filter({ hasText: "Erste Aufgabe" }).locator(".session-open").click();
    await expect(app.locator(".split-detail .session-top-title")).toHaveText("Erste Aufgabe");
    // P21-Invariante gilt auch auf dem Tablet: das Fenster selbst scrollt nie.
    const overflow = await app.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("Die 1280-px-Grenze schaltet live: 1279 Phone, 1280 Split (T8.5, AC-P8-6) @tablet", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Grenze" });
    await app.setViewportSize({ width: 1279, height: 800 });
    await expect(app.locator(".split")).toHaveCount(0);
    await expect(app.locator(".dock-stack")).toBeVisible();
    await app.setViewportSize({ width: 1280, height: 800 });
    await expect(app.locator(".split")).toBeVisible();
  });
});
