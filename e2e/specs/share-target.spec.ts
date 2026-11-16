import { test, expect } from "../support/fixtures.ts";

/**
 * AI-P9-2 / T9.x (nach T12.4 verschoben, Text-/URL-Anteil hier umgesetzt):
 * Das Teilen-Menü einer anderen App öffnet die PWA mit GET-Parametern
 * (manifest share_target) — der Text muss vorbefüllt in Neuer Session
 * landen, ohne dass ein ungesendeter eigener Auftrag überschrieben wird.
 */
test.describe("Share Target (AI-P9-2)", () => {
  test("manifest deklariert share_target als GET auf /", async ({ app, hub }) => {
    const res = await app.request.get(`${hub.origin}/manifest.webmanifest`);
    expect(res.ok()).toBeTruthy();
    const manifest = (await res.json()) as { share_target?: { action: string; method: string; params: Record<string, string> } };
    expect(manifest.share_target?.action).toBe("/");
    expect(manifest.share_target?.method).toBe("GET");
    expect(manifest.share_target?.params).toMatchObject({ title: "title", text: "text", url: "url" });
  });

  test("Geteiltes landet vorbefüllt in Neuer Session, URL wird bereinigt @desktop", async ({ app, hub }) => {
    await app.goto(`${hub.origin}/?title=Bugfix-Hinweis&text=Schau%20dir%20das%20an&url=https://example.com/x`);
    await expect(app).toHaveURL(/\/#\/neu$/);
    await expect(app.getByPlaceholder("Refactore den Auth-Flow…")).toHaveValue("Bugfix-Hinweis\n\nSchau dir das an\n\nhttps://example.com/x");
    await app.getByLabel("Adapter").selectOption("opencode");
    await app.getByRole("button", { name: "Starten" }).click();
    await expect(app).toHaveURL(/#\/sessions\//);
    await expect(app.locator(".event.user").first()).toContainText("Schau dir das an", { timeout: 20_000 });
  });
});
