import { test, expect, dockGo, sessionTab } from "../support/fixtures.ts";

/** ADR-0083 supersedes EPIC-P58's simulated typing. Persisted blocks and
 * history render completely; only real provider frames may grow live. */
test.describe("Blockausgabe ohne simuliertes Tippen (ADR-0083)", () => {
  test.use({ hubOptions: { dummyEventsPerSecond: 6, dummyAutoStop: 14 } });

  test("der entfernte Typwriter-Schalter erscheint auch nach Reload nicht", async ({ app }) => {
    await app.evaluate(() => localStorage.setItem("ancientvoid.typewriter", "1"));
    await app.reload();
    await dockGo(app, "Einstellungen");
    await expect(app.getByRole("heading", { name: "Darstellung", exact: true })).toBeVisible();
    await expect(app.getByRole("switch", { name: "Typwriter-Effekt" })).toHaveCount(0);
  });

  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    test(`alte Typwriter-Präferenz verändert vollständige Blöcke und History nicht (${reducedMotion})`, async ({ app, hub }) => {
      await app.emulateMedia({ reducedMotion });
      await app.evaluate(() => localStorage.setItem("ancientvoid.typewriter", "1"));
      const id = await hub.createSession({ adapter: "dummy", prompt: "Vollständige Ausgabe" });
      await app.goto(`${hub.origin}/#/sessions/${id}`);
      await sessionTab(app, "Chat");
      await hub.until(async () => (await hub.events(id)).some((event) => event.summary === "dummy: auto-stop reached"), "completed blocks");
      const events = await hub.events(id);
      const blocks = events.filter((event, i) => event.type === "assistant" && events[i - 1]?.type === "tool_result");
      expect(blocks.length).toBeGreaterThanOrEqual(1);
      for (const event of blocks) {
        const row = app.locator(`.event.assistant[data-seq="${event.seq}"] .summary`).first();
        await expect(row).toHaveText(event.summary);
      }
      await expect(app.getByTestId("chat-live")).toHaveCount(0);
      await app.reload();
      await sessionTab(app, "Chat");
      for (const event of blocks) {
        await expect(app.locator(`.event.assistant[data-seq="${event.seq}"] .summary`).first()).toHaveText(event.summary);
      }
      await expect(app.getByTestId("chat-live")).toHaveCount(0);
    });
  }
});
