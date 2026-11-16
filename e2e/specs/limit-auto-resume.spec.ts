import { test, expect } from "../support/fixtures.ts";

/** ADR-0076 Nachtrag (Limit-Wiederaufnahme): starb ein Zug am Kontingent,
 * entscheidet der Mensch pro Session über automatische Fortsetzung. Der
 * Dummy-Adapter stirbt im ersten Zug am Limit (Fenster bereits frei); die
 * Option an der Fehler-Banner überführt die Session in die Wiederaufnahme. */
test.describe("Limit-Wiederaufnahme", () => {
  test.use({ hubOptions: { limitDummy: true } });

  test("Fehler-Banner bietet die Option, Automatik setzt die Session fort @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy", prompt: "Präsentation weiterbauen" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "error", "Kontingent-Fehler → error");
    const banner = app.getByRole("status", { name: "Session benötigt Entscheidung" });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("session limit");
    const enable = banner.getByRole("button", { name: "Nach Limit automatisch weitermachen" });
    await expect(enable).toBeVisible();
    await enable.click();
    // Die Überführung in die Wartestellung + freies Fenster → Auto-Resume.
    await hub.until(async () => (await hub.events(id)).some(e => e.payload.kind === "session.resumed" && e.payload.actor === "auto-resume"), "automatische Fortsetzung");
    const status = (await hub.api<{ status: string; autoResumeOnLimit: boolean }>(`/api/sessions/${id}`)).body;
    expect(status.autoResumeOnLimit).toBe(true);
    expect(["working", "idle"]).toContain(status.status);
    await expect(banner).toHaveCount(0);
  });

  test("ohne die Option bleibt der Kontingent-Fehler eine Entscheidung @desktop", async ({ hub }) => {
    const id = await hub.createSession({ adapter: "dummy", prompt: "Ohne Option" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "error", "error ohne Option");
    expect((await hub.events(id)).some(e => e.payload.kind === "session.resumed")).toBe(false);
    const record = (await hub.api<{ status: string; autoResumeOnLimit: boolean }>(`/api/sessions/${id}`)).body;
    expect(record).toMatchObject({ status: "error", autoResumeOnLimit: false });
  });
});
