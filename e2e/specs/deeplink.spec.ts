import { test, expect } from "../support/fixtures.ts";

test.describe("Deep-Link und Attach (AC-P5-5)", () => {
  test("ein Session-Link öffnet nach Reload dieselbe Session @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".topbar")).toContainText("dummy");
    await app.reload();
    await expect(app.locator(".topbar")).toContainText("dummy");
    expect(app.url()).toContain(`#/sessions/${id}`);
  });

  test("ein unbekannter Link landet in der Übersicht", async ({ app, hub }) => {
    await app.goto(`${hub.origin}/#/sessions/gibt-es-nicht`);
    await expect(app.getByText("keine Sessions — lege eine an")).toBeVisible();
  });

  test("ohne tmux gibt es nie einen Attach-Befehl", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Arbeite LANGSAM" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Bericht" }).click();
    await expect(app.locator(".kv-list")).toBeVisible();
    await expect(app.locator(".attach-cmd-card")).toHaveCount(0);
  });

  test.describe("mit tmux-Worker", () => {
    test.use({ hubOptions: { runner: "tmux" } });

    test("Attach nur, solange ein Worker läuft", async ({ app, hub }) => {
      const id = await hub.createSession({ adapter: "opencode", prompt: "Arbeite LANGSAM" });
      await hub.until(async () => (await hub.events(id)).some((e) => e.type === "tool_use"), "worker running");
      await app.goto(`${hub.origin}/#/sessions/${id}`);
      await app.getByRole("button", { name: "Bericht" }).click();
      await expect(app.locator(".attach-cmd-card code")).toHaveText(`tmux attach -t uacc-${id}`);
      await app.getByRole("button", { name: "Stop" }).click();
      await expect(app.locator(".topbar .pill")).toHaveText("stopped");
      await expect(app.locator(".attach-cmd-card")).toHaveCount(0);
    });
  });
});
