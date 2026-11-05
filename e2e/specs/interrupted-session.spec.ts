import type { TestHub } from "../support/hub.ts";
import { test, expect } from "../support/fixtures.ts";

test.describe("P27 unterbrochene Sessions", () => {
  test.use({ hubOptions: { dummyAutoStop: 0, interruptedDummy: { resume: true } } });

  async function lost(hub: TestHub, id: string) {
    await hub.api(`/api/sessions/${id}/steer`, { body: { kind: "prompt", text: "P27: worker transport lost" } });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "interrupted", "worker interrupted");
  }

  test("Worker-Ausfall: Banner, abgebrochener Bericht, Weitermachen und Archivieren @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy", prompt: "Offener Zug" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await lost(hub, id);
    const banner = app.getByRole("status", { name: "Session unterbrochen" });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Agent-Prozess unerwartet beendet");
    await expect(banner).toContainText("Letzter Zug:");
    await app.getByRole("button", { name: "Bericht", exact: true }).click();
    await expect(app.getByText("Unterbrochen — Zug abgebrochen")).toBeVisible();
    const end = (await hub.events(id)).filter(e => e.payload.kind === "session.turn_end");
    expect(end).toHaveLength(1);
    expect(end[0]?.payload.reason).toBe("interrupted");
    await banner.getByRole("button", { name: "Weitermachen" }).click();
    await expect(banner).toHaveCount(0);
    expect((await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status).toBe("working");
    await lost(hub, id);
    await expect(banner).toBeVisible();
    await banner.getByRole("button", { name: "Archivieren" }).click();
    await expect(banner).toHaveCount(0);
    expect((await hub.api<{ status: string; archived: boolean }>(`/api/sessions/${id}`)).body).toMatchObject({ status: "stopped", archived: true });
  });

  test("unbekannter Status bleibt als Text sichtbar @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy", prompt: "Zukünftiger Status" });
    await app.route(`**/api/sessions/${id}`, async route => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...await response.json(), status: "future_status" } });
    });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".session-topbar .pill[data-status='future_status']")).toHaveText("future_status");
  });

  test("Hub-Neustart kennzeichnet den verlorenen Zug; Übersicht zeigt unterbrochen @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy", prompt: "Vor Neustart" });
    await hub.until(async () => (await hub.events(id)).some(e => e.payload.nativeSessionId), "native identity");
    await hub.restart("SIGKILL");
    await app.reload();
    await expect(app.locator(".session-card").filter({ hasText: "Vor Neustart" })).toContainText("unterbrochen");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.getByRole("status", { name: "Session unterbrochen" })).toContainText("Hub neu gestartet");
  });
});

test.describe("P27 fehlende Resume-Deklaration", () => {
  test.use({ hubOptions: { dummyAutoStop: 0, interruptedDummy: { resume: false } } });
  test("ehrliche Meldung, Archivieren funktioniert trotzdem @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy", prompt: "Nicht fortsetzbar" });
    await hub.api(`/api/sessions/${id}/steer`, { body: { kind: "prompt", text: "P27: worker transport lost" } });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const banner = app.getByRole("status", { name: "Session unterbrochen" });
    await expect(banner).toContainText("Dieser Adapter kann nicht nativ fortsetzen");
    await expect(banner.getByRole("button", { name: "Weitermachen" })).toBeDisabled();
    expect((await hub.api(`/api/sessions/${id}/resume`, { body: {} })).status).toBe(422);
    await banner.getByRole("button", { name: "Archivieren" }).click();
    await expect(banner).toHaveCount(0);
  });
});

test.describe("P27 explizites Auto-Resume", () => {
  test.use({ hubOptions: { dummyAutoStop: 0, interruptedDummy: { resume: true, auto: true } } });
  test("Dummy läuft nur mit deklarierter und konfigurierter Freigabe weiter @desktop", async ({ hub }) => {
    const id = await hub.createSession({ adapter: "dummy", prompt: "Automatisch" });
    await hub.api(`/api/sessions/${id}/steer`, { body: { kind: "prompt", text: "P27: worker transport lost" } });
    await hub.until(async () => (await hub.events(id)).some(e => e.payload.kind === "session.resumed" && e.payload.actor === "auto-resume"), "automatic resume");
    expect((await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status).toBe("working");
  });
});
