import { test, expect } from "../support/fixtures.ts";
import type { Page } from "@playwright/test";

/**
 * EPIC-P43 T43.2: ein Baustein (`StatusDot`) sagt den Zustand in Farbe, Form und Bewegung —
 * jede der drei reicht allein (AC-P43-4), ohne Bewegung bleibt die Aussage (AC-P43-5).
 */
const card = (app: Page, title: string) => app.locator(".session-card", { has: app.locator(".session-title", { hasText: title }) });
/** Ein Gerät, das die App schon kennt: der Lesezeiger existiert, neue Züge sind hier ungesehen (T8.6). */
async function openStart(app: Page, origin: string): Promise<void> {
  await app.goto(`${origin}/#/`);
  await app.evaluate(() => localStorage.setItem("ancientvoid.seen", "{}"));
  await app.reload();
}
const mark = (app: Page, title: string) => card(app, title).locator(".status-mark");
const animation = (app: Page, title: string) => mark(app, title).evaluate((el) => getComputedStyle(el).animationName);

test.describe("Zustandssprache (EPIC-P43 T43.2)", () => {
  test("Freigabe, Frage, Arbeit und fertiger Zug sind verschiedene Zustände mit eigenem Wort und eigener Form @tablet @desktop", async ({ app, hub }) => {
    await hub.createSession({ adapter: "claude", prompt: "Bitte WERKZEUG ausführen" });
    await hub.createSession({ adapter: "claude", prompt: "Bitte FRAGE stellen" });
    await hub.createSession({ adapter: "opencode", prompt: "README zusammenfassen" });
    await hub.createSession({ adapter: "opencode", prompt: "Arbeite LANGSAM" });
    await openStart(app, hub.origin);

    const approval = card(app, "WERKZEUG").locator(".status");
    await expect(approval).toHaveAttribute("data-display", "approval");
    await expect(approval).toHaveText("Freigabe nötig");
    // Der rohe Hub-Status bleibt lesbar: eine Frage ist für den Hub weiterhin eine offene Freigabe.
    const question = card(app, "FRAGE").locator(".status");
    await expect(question).toHaveAttribute("data-display", "question");
    await expect(question).toHaveAttribute("data-status", "waiting_approval");
    await expect(question).toHaveText("Frage");
    await expect(card(app, "LANGSAM").locator(".status")).toHaveAttribute("data-display", "working");
    // Ein beendeter Zug, den hier noch niemand angesehen hat, ruft: „fertig“ als offener Ring.
    const done = card(app, "README").locator(".status");
    await expect(done).toHaveAttribute("data-display", "done", { timeout: 20_000 });
    await expect(done).toHaveText("fertig");

    // Form ohne Farbe: Ring (leer), Punkt mit Hof, gefüllter Punkt.
    const shape = (title: string) => mark(app, title).evaluate((el) => { const s = getComputedStyle(el); return { filled: s.backgroundColor !== "rgba(0, 0, 0, 0)", halo: s.boxShadow !== "none" && !s.boxShadow.includes("inset") }; });
    expect(await shape("README")).toEqual({ filled: false, halo: false });
    expect(await shape("WERKZEUG")).toEqual({ filled: true, halo: true });
    expect(await shape("LANGSAM")).toEqual({ filled: true, halo: false });
    // Farbe: Freigabe und Frage teilen sich keine.
    const color = (title: string) => mark(app, title).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await color("WERKZEUG")).not.toBe(await color("FRAGE"));
  });

  test("angesehen wird aus „fertig“ wieder „bereit“ — im Kopf der Session und danach auf der Karte", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "README zusammenfassen" });
    await openStart(app, hub.origin);
    await expect(card(app, "README").locator(".status")).toHaveText("fertig", { timeout: 20_000 });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".session-topbar .status")).toHaveText("bereit");
    // Der Lesezeiger wandert nach 1,5 s (T8.6).
    await app.waitForTimeout(2000);
    await app.goto(`${hub.origin}/#/`);
    await expect(card(app, "README").locator(".status")).toHaveText("bereit");
    await expect(card(app, "README").locator(".status")).toHaveAttribute("data-display", "quiet");
  });

  test("Arbeit atmet; Schalter „Bewegung“, Systemvorgabe und getrennte Verbindung halten sie an @desktop", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Arbeite LANGSAM" });
    await app.goto(`${hub.origin}/#/`);
    await expect(card(app, "LANGSAM").locator(".status")).toHaveAttribute("data-display", "working");
    expect(await animation(app, "LANGSAM")).toBe("mv-breathe");
    // Keine dritte Dauerschleife mehr an der Karte (früher: umlaufende Randlinie).
    expect(await card(app, "LANGSAM").evaluate((el) => getComputedStyle(el, "::after").animationName)).toBe("none");

    // K10: ohne Verbindung steht die Bewegung, statt Arbeit vorzutäuschen.
    await app.route("**/api/**", (route) => route.abort("connectionrefused"));
    await expect(app.locator("html")).toHaveAttribute("data-conn", "off", { timeout: 20_000 });
    expect(await mark(app, "LANGSAM").evaluate((el) => getComputedStyle(el).animationPlayState)).toBe("paused");
    await app.unroute("**/api/**");
    await expect(app.locator("html")).toHaveAttribute("data-conn", "on", { timeout: 20_000 });

    await app.evaluate(() => (document.documentElement.dataset.ctxMotion = "off"));
    expect(await animation(app, "LANGSAM")).toBe("none");
    await expect(card(app, "LANGSAM").locator(".status")).toHaveText("arbeitet");
    await app.evaluate(() => (document.documentElement.dataset.ctxMotion = "on"));
    await app.emulateMedia({ reducedMotion: "reduce" });
    expect(await animation(app, "LANGSAM")).toBe("none");
  });
});
