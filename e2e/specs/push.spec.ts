import { test, expect } from "../support/fixtures.ts";

test.describe("Benachrichtigungen (T8.3, AC-P8-3)", () => {
  test("Push ist aus, bis man es einschaltet; ein blockierter Browser wird genannt", async ({ app, hub }) => {
    await app.addInitScript(() => {
      // As on a phone where the user said "no" once.
      Object.defineProperty(globalThis.Notification ?? {}, "permission", { get: () => "denied" });
    });
    await app.goto(`${hub.origin}/#/einstellungen`);
    const card = app.locator("[data-testid=push-settings]");
    await expect(card).toContainText("verlässt damit das Tailnet");
    const toggle = card.getByLabel("Push auf diesem Hub erlauben");
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await expect(card.locator(".push-status")).toContainText(/blockiert|kann hier kein Push/);
    const state = (await hub.api<{ enabled: boolean; publicKey: string | null }>("/api/push")).body;
    expect(state.enabled).toBe(true);
    expect(state.publicKey).toEqual(expect.any(String));
    await toggle.uncheck();
    await expect.poll(async () => (await hub.api<{ enabled: boolean }>("/api/push")).body.enabled).toBe(false);
  });
});
