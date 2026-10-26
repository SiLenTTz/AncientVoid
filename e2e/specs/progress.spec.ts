import { test, expect } from "../support/fixtures.ts";

test.describe("Fortschritt und Kontingent im Lauf", () => {
  test("mit Plan: Aufgaben, Prozent und Restzeit, danach verschwindet die Anzeige @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "PLAN WARTE4" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const progress = app.locator(".run-progress");
    // First snapshot: percent yes, but no ETA yet — one snapshot has no
    // velocity to measure (BUG-0062), a guess would pretend to know.
    await expect(progress).toContainText("1/4 Aufgaben · 25 %");
    await expect(progress).not.toContainText("noch ca.");
    // Second snapshot 1.5 s later: velocity exists, an ETA appears —
    // tied to the snapshots, not to the running clock.
    await expect(progress).toContainText("2/4 Aufgaben · 50 %");
    await expect(progress).toContainText("noch ca.");
    await expect(app.locator(".run-bar span")).toHaveAttribute("style", /width: 50%/);
    await expect(app.locator(".topbar .pill")).toHaveAttribute("data-status", "idle", { timeout: 15_000 });
    await expect(progress).toHaveCount(0);
  });

  test("ohne Plan: nur die Laufzeit, keine erfundene Prozentzahl", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Arbeite WARTE4" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".run-progress")).toContainText("läuft seit");
    await expect(app.locator(".run-progress")).toContainText("ohne Plan kein Fortschritt messbar");
    await expect(app.locator(".run-bar")).toHaveCount(0);
  });

  test("ohne Plan, mit Zughistorie: die typische Zugdauer als grobe Restzeit", async ({ app, hub }) => {
    // Two short finished turns first — only then does a third running turn
    // have enough history for the honest "Zug hier meist" fallback (one
    // duration is no statistics, same rule as the plan ETA).
    const id = await hub.createSession({ adapter: "opencode", prompt: "Erster WARTE2" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "turn 1 idle");
    await hub.api(`/api/sessions/${id}/steer`, { body: { kind: "prompt", text: "Zweiter WARTE2" } });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "turn 2 idle");
    await hub.api(`/api/sessions/${id}/steer`, { body: { kind: "prompt", text: "Dritter WARTE12" } });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".run-progress")).toContainText("läuft seit");
    await expect(app.locator(".run-progress")).toContainText(/Zug hier meist .+ \(2 gelaufen\)/);
    await expect(app.locator(".run-progress")).not.toContainText("ohne Plan kein Fortschritt messbar");
    await expect(app.locator(".run-bar")).toHaveCount(0);
  });

  test("die ganze Session-Ansicht trägt den aktiven Rahmen wie die Übersichtskarte", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Rahmen WARTE6" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    // Same class language as the overview card (st-working) — visible on
    // every tab, not just the small status pill.
    await expect(app.locator(".session-live.st-working")).toHaveCount(1);
    await expect(app.locator(".topbar .pill")).toHaveAttribute("data-status", "idle", { timeout: 20_000 });
    await expect(app.locator(".session-live.st-working, .session-live.st-waiting")).toHaveCount(0);
  });

  test("das Kontingent zeigt, was der Provider meldet", async ({ app, hub }) => {
    const ok = await hub.createSession({ adapter: "opencode", prompt: "Kurz" });
    await app.goto(`${hub.origin}/#/sessions/${ok}`);
    await expect(app.locator(".run-quota")).toHaveText("Kontingent: Provider meldet nichts");

    const limited = await hub.createSession({ adapter: "opencode", prompt: "Bitte KONTINGENT" });
    await app.goto(`${hub.origin}/#/sessions/${limited}`);
    await expect(app.locator(".run-quota.err")).toHaveText("5 h: erschöpft · frei ab 2026-09-23 15:00:00");
  });
});
