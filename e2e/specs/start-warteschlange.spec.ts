import { test, expect, openQuiet } from "../support/fixtures.ts";
import type { Page } from "@playwright/test";

/**
 * EPIC-P43 T43.3: der Start ist eine Warteschlange — „Du bist dran“, „Arbeitet“, „Ruhig“ — und
 * eine entscheidbare Freigabe wird auf der Karte entschieden (AC-P43-2).
 */
const card = (app: Page, title: string) => app.locator(".session-card", { has: app.locator(".session-title", { hasText: title }) });
/** Ein Gerät, das die App schon kennt: neue Züge sind hier ungesehen (T8.6). */
async function openStart(app: Page, origin: string): Promise<void> {
  await app.goto(`${origin}/#/`);
  await app.evaluate(() => localStorage.setItem("ancientvoid.seen", "{}"));
  await app.reload();
}

test.describe("Start als Warteschlange (EPIC-P43 T43.3)", () => {
  test("AC-P43-2: eine Freigabe wird auf der Karte mit einem Tipp erlaubt — Befehl, Einschätzung und Restzeit stehen dabei @tablet @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "Bitte WERKZEUG ausführen" });
    await openStart(app, hub.origin);
    const decision = card(app, "WERKZEUG").locator(".card-decision");
    await expect(decision.locator(".tool-badge")).toHaveText("Bash");
    await expect(decision.locator(".card-decision-input")).toContainText("echo hallo-ancientvoid");
    await expect(decision.locator(".assessment")).toContainText("Laya");
    await expect(decision.locator(".card-decision-left")).toHaveText(/noch \d+ s/);
    const approve = decision.getByRole("button", { name: "Erlauben" });
    const box = (await approve.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(30);
    await approve.click();
    // Entschieden: die Tasten sind sofort weg, der Hub hat die Freigabe.
    await expect(decision).toHaveCount(0);
    await hub.until(async () => (await hub.api<{ id: string; status: string; sessionId: string }[]>("/api/approvals")).body.some((a) => a.sessionId === id && a.status === "approved"), "approved");
    await expect(app).toHaveURL(/#\/$/);
  });

  test("Ablehnen auf der Karte lehnt ab; eine Rückfrage trägt keine Tasten, sondern öffnet die Session", async ({ app, hub }) => {
    const tool = await hub.createSession({ adapter: "claude", prompt: "Bitte WERKZEUG ausführen" });
    const ask = await hub.createSession({ adapter: "claude", prompt: "Bitte FRAGE stellen" });
    await openStart(app, hub.origin);
    await expect(card(app, "FRAGE").locator(".status")).toHaveText("Frage");
    await expect(card(app, "FRAGE").locator(".card-decision")).toHaveCount(0);
    await card(app, "WERKZEUG").locator(".card-decision").getByRole("button", { name: "Ablehnen" }).click();
    await hub.until(async () => (await hub.api<{ status: string; sessionId: string }[]>("/api/approvals")).body.some((a) => a.sessionId === tool && a.status === "rejected"), "rejected");
    await card(app, "FRAGE").locator(".session-open").click();
    await expect(app).toHaveURL(new RegExp(`#/sessions/${ask}`));
    await expect(app.locator(".session-approvals .approval-card")).toBeVisible();
  });

  test("Gruppen: fertig und Freigabe oben, Arbeit darunter, „Ruhig“ zu — und die Wahl bleibt nach dem Neuladen @tablet @desktop", async ({ app, hub }) => {
    const quiet = await hub.createSession({ adapter: "dummy", prompt: "Stille Sache" });
    await hub.api(`/api/sessions/${quiet}/stop`, { body: {} });
    await hub.createSession({ adapter: "claude", prompt: "Bitte WERKZEUG ausführen" });
    await hub.createSession({ adapter: "opencode", prompt: "README zusammenfassen" });
    await hub.createSession({ adapter: "opencode", prompt: "Arbeite LANGSAM" });
    await openStart(app, hub.origin);
    await expect(app.locator(".section-title")).toContainText(["Du bist dran", "Arbeitet", "Ruhig"]);
    // Was abläuft, steht vor dem, was nur fertig ist.
    await expect(app.locator(".section-braucht .session-title")).toHaveText([/WERKZEUG/, /README/], { timeout: 20_000 });
    await expect(app.locator(".section-aktiv .session-title")).toHaveText([/LANGSAM/]);
    await expect(card(app, "LANGSAM").locator(".session-activity-text")).not.toBeEmpty();
    // G63: der Weg zur Liste aller Freigaben bleibt.
    await expect(app.locator(".section-braucht .approval-link")).toContainText("1 Freigabe");

    // G62: „Ruhig“ ist zu, zählt aber; aufklappen zeigt die Karte, die Wahl ist Gerätezustand.
    const fold = app.locator(".section-zuletzt .section-fold");
    await expect(fold).toHaveAttribute("aria-expanded", "false");
    await expect(fold).toContainText("1");
    await expect(card(app, "Stille Sache")).toHaveCount(0);
    await openQuiet(app);
    await expect(card(app, "Stille Sache")).toBeVisible();
    await app.reload();
    await expect(card(app, "Stille Sache")).toBeVisible();
    await fold.click();
    await expect(card(app, "Stille Sache")).toHaveCount(0);

    await app.locator(".section-braucht .approval-link").click();
    await expect(app).toHaveURL(/#\/freigaben$/);
  });

  test("BUG-0147: Erststart mit leerem Hub — die ersten Sessions sind neu, nicht schon gelesen", async ({ app, hub }) => {
    await app.goto(`${hub.origin}/#/`);
    await expect(app.locator(".empty", { hasText: "lade" })).toHaveCount(0);
    // Abfragen anhalten, bis die erste Session fertig ist — so kommt sie fertig in der ersten nicht leeren Antwort an.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await app.route("**/api/fleet", async (route) => {
      await gate;
      await route.continue();
    });
    const id = await hub.createSession({ adapter: "opencode", prompt: "README zusammenfassen" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "idle");
    release();
    await expect(app.locator(".section-braucht .session-title")).toHaveText([/README/]);
    await app.unroute("**/api/fleet");
    await app.reload();
    await expect(app.locator(".section-braucht .session-title")).toHaveText([/README/]);
    await expect(app.locator(".section-zuletzt")).toHaveCount(0);
  });

  test("ohne Arbeit und ohne Ruf ist „Ruhig“ offen; Suchen öffnet es immer", async ({ app, hub }) => {
    for (const title of ["Eins", "Zwei", "Drei", "Vier", "Fünf"]) {
      const id = await hub.createSession({ adapter: "dummy", prompt: `Stille ${title}` });
      await hub.api(`/api/sessions/${id}/stop`, { body: {} });
    }
    await app.goto(`${hub.origin}/#/`);
    await expect(app.locator(".section-zuletzt .session-card")).toHaveCount(5);
    await hub.createSession({ adapter: "opencode", prompt: "Arbeite LANGSAM" });
    await expect(app.locator(".section-aktiv .session-card")).toHaveCount(1);
    await expect(app.locator(".section-zuletzt .session-card")).toHaveCount(0);
    await app.getByLabel("Sessions filtern").fill("Stille Drei");
    await expect(app.locator(".section-zuletzt .session-card")).toHaveCount(1);
  });

  test("Wandern: eine Karte, die die Gruppe wechselt, kommt mit Bewegung an — ohne Bewegung steht sie einfach da @desktop", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Kurzer Zug WARTE6" });
    await openStart(app, hub.origin);
    await expect(app.locator(".section-aktiv .session-card")).toHaveCount(1);
    const arrived = app.locator(".section-braucht .session-card");
    await expect(arrived).toHaveCount(1, { timeout: 30_000 });
    await expect(arrived).toHaveClass(/mv-wander/);
    await app.emulateMedia({ reducedMotion: "reduce" });
    expect(await arrived.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  });
});
