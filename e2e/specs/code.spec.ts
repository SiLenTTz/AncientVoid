import { test, expect } from "../support/fixtures.ts";

test.describe("Code und Aktionen (T7.6, AC-P7-6)", () => {
  test("eine bekannte Funktion in .ts und .py finden, mit Zeilenanker öffnen — auch nach dem Neuladen", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Code", exact: true }).click();
    await app.getByLabel("Code durchsuchen").fill("parseToken");
    await app.getByRole("button", { name: "Suchen" }).click();
    const first = app.locator(".code-hit").first();
    await expect(first).toContainText("src/auth.ts:4");
    await expect(first).toContainText("Definition");
    await expect(app.locator(".code-identity").first()).toContainText("Worktree der Session");
    await first.click();
    await expect(app.locator(".code-lines li.hit")).toHaveAttribute("id", "L4");
    await expect(app.locator(".code-lines li.hit code")).toContainText("export function parseToken");
    await expect(app).toHaveURL(/\/code\/src\/auth\.ts:L4$/);

    // A tapped line number becomes the anchor; the link survives a reload.
    await app.getByRole("button", { name: "Zeile 5" }).click();
    await expect(app).toHaveURL(/:L5$/);
    await app.reload();
    await expect(app.locator(".code-lines li.hit")).toHaveAttribute("id", "L5");

    await app.getByRole("button", { name: "← Suche" }).click();
    await app.getByLabel("Code durchsuchen").fill("parse_token");
    await app.getByRole("button", { name: "Suchen" }).click();
    await expect(app.locator(".code-hit").first()).toContainText("tools/check.py:4");
    // New timeline events (here: from an action) must not scroll the search away.
    await app.locator(".action-row").filter({ hasText: "Letzte Commits" }).getByRole("button", { name: "Ausführen" }).click();
    await expect(app.locator(".action-run .action-status").first()).toHaveText("erfolgreich");
    await expect.poll(async () => (await hub.events(id)).filter((e) => e.type === "tool_result").length).toBeGreaterThan(0);
    await app.waitForTimeout(300);
    await expect(app.getByLabel("Code durchsuchen")).toBeInViewport();
  });

  test("eine registrierte Aktion läuft im Worktree, mit Status und Ausgabe", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Code", exact: true }).click();
    const row = app.locator(".action-row").filter({ hasText: "Git-Status" });
    await row.getByRole("button", { name: "Ausführen" }).click();
    const run = app.locator(".action-run").first();
    await expect(run.locator(".action-status")).toHaveText("erfolgreich");
    await expect(run.locator(".action-output")).toContainText("##");
    const events = await hub.events(id);
    expect(events.some((e) => e.type === "tool_result" && (e.payload as { name?: string }).name === "aktion:git-status")).toBe(true);
  });
});
