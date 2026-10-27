import { test, expect } from "../support/fixtures.ts";
import type { Page } from "@playwright/test";

/** EPIC-P18: up to four sessions as tiles on a wide screen. */
test.describe("Desktop-Workspace (EPIC-P18)", () => {
  test.use({ viewport: { width: 2560, height: 1440 } });

  const card = (app: Page, text: string) => app.locator(".split-list .session-card").filter({ hasText: text }).locator(".session-open");
  const tile = (app: Page, n: number) => app.locator(`.tile[data-tile="${n}"]`);

  test("Strg-Klick öffnet weitere Kacheln bis 2×2, jede Kachel zeigt ihre Session mit Token-Zeile (AC-P18-2)", async ({ app, hub }) => {
    for (const name of ["Eins", "Zwei", "Drei", "Vier"]) await hub.createSession({ adapter: "opencode", prompt: `Aufgabe ${name}` });
    await card(app, "Aufgabe Eins").click();
    await card(app, "Aufgabe Zwei").click({ modifiers: ["Control"] });
    await expect(app.locator(".tile-layout-btn.active")).toHaveAttribute("aria-label", "Zwei nebeneinander");
    await card(app, "Aufgabe Drei").click({ modifiers: ["Control"] });
    await card(app, "Aufgabe Vier").click({ modifiers: ["Control"] });
    await expect(app.locator(".tile-layout-btn.active")).toHaveAttribute("aria-label", "Vier als Raster");
    for (const [n, name] of ["Eins", "Zwei", "Drei", "Vier"].entries()) {
      await expect(tile(app, n + 1).locator(".session-top-title")).toHaveText(`Aufgabe ${name}`);
      await expect(tile(app, n + 1).locator(".run-tokens")).toContainText("Kontext");
    }
    await expect(tile(app, 4)).toHaveClass(/focused/);
  });

  test("eine Antwort in Kachel 3 geht nur an die Session in Kachel 3 (P18-Premortem 1)", async ({ app, hub }) => {
    const ids: string[] = [];
    for (const name of ["Eins", "Zwei", "Drei"]) ids.push(await hub.createSession({ adapter: "opencode", prompt: `Aufgabe ${name}` }));
    await card(app, "Aufgabe Eins").click();
    await card(app, "Aufgabe Zwei").click({ modifiers: ["Control"] });
    await card(app, "Aufgabe Drei").click({ modifiers: ["Control"] });
    const third = tile(app, 3);
    // A half-height tile starts with its controls folded (P18 premortem 3).
    await third.getByRole("button", { name: "Steuerung einblenden" }).click();
    await third.getByPlaceholder("Antworten…").fill("Nur für Drei");
    await third.getByRole("button", { name: "Senden" }).click();
    await hub.until(async () => (await hub.events(ids[2]!)).some((e) => e.summary.includes("Nur für Drei")), "reply in session three");
    for (const id of ids.slice(0, 2)) expect((await hub.events(id)).some((e) => e.summary.includes("Nur für Drei"))).toBe(false);
  });

  test("Tastatur: Layout wechseln, Fokus, Tauschen, Leeren (AC-P18-3)", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Aufgabe Links" });
    await hub.createSession({ adapter: "opencode", prompt: "Aufgabe Rechts" });
    await card(app, "Aufgabe Links").click();
    await card(app, "Aufgabe Rechts").click({ modifiers: ["Control"] });
    await expect(tile(app, 2)).toHaveClass(/focused/);
    await app.keyboard.press("Alt+1");
    await expect(tile(app, 1)).toHaveClass(/focused/);
    await app.keyboard.press("Alt+Shift+2");
    await expect(tile(app, 1).locator(".session-top-title")).toHaveText("Aufgabe Rechts");
    await expect(tile(app, 2).locator(".session-top-title")).toHaveText("Aufgabe Links");
    await expect(tile(app, 2)).toHaveClass(/focused/);
    await app.keyboard.press("Alt+L");
    await expect(app.locator(".tile-layout-btn.active")).toHaveAttribute("aria-label", "Zwei übereinander");
    await app.keyboard.press("Alt+W");
    await expect(tile(app, 2).locator(".tile-empty")).toBeVisible();
    await expect(tile(app, 1).locator(".session-top-title")).toHaveText("Aufgabe Rechts");
  });

  test("nach Reload sind Layout und Belegung gleich; eine gelöschte Session sagt es (AC-P18-3, Premortem 4)", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Aufgabe Bleibt" });
    const gone = await hub.createSession({ adapter: "opencode", prompt: "Aufgabe Geht" });
    await card(app, "Aufgabe Bleibt").click();
    await card(app, "Aufgabe Geht").click({ modifiers: ["Control"] });
    await app.getByRole("button", { name: "Zwei übereinander" }).click();
    await app.reload();
    await expect(app.locator(".tile-layout-btn.active")).toHaveAttribute("aria-label", "Zwei übereinander");
    await expect(tile(app, 1).locator(".session-top-title")).toHaveText("Aufgabe Bleibt");
    await expect(tile(app, 2).locator(".session-top-title")).toHaveText("Aufgabe Geht");
    await hub.api(`/api/sessions/${gone}/stop`, { body: {} });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${gone}`)).body.status === "stopped", "stopped");
    expect((await hub.api(`/api/sessions/${gone}`, { method: "DELETE", body: {} })).status).toBeLessThan(300);
    await app.reload();
    await expect(tile(app, 2).locator(".tile-missing")).toContainText("gibt es nicht mehr");
    await tile(app, 2).getByRole("button", { name: "Kachel leeren" }).last().click();
    await expect(tile(app, 2).locator(".tile-empty")).toContainText("frei");
  });

  test("unter 1280 px gibt es keine Kacheln (AC-P18-4)", async ({ app, hub }) => {
    await app.setViewportSize({ width: 1024, height: 900 });
    const id = await hub.createSession({ adapter: "opencode", prompt: "Schmal" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".session-top-title")).toHaveText("Schmal");
    await expect(app.locator(".tile-workspace")).toHaveCount(0);
  });
});
