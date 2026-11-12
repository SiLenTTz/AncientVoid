import { test, expect } from "../support/fixtures.ts";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

/** ADR-0071: Git-Commit-Graph mit farbigen Linien und Datei → Explorer. */

test.describe("Git-Graph", () => {
  test("Hash öffnet den Git-Tab mit Commits und Branch-Chips", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy", prompt: "Git Graph" });
    await app.goto(`${hub.origin}/#/sessions/${id}/git`);
    await expect(app.locator(".session-live[data-tab='git']")).toBeVisible();
    await expect(app.locator('[data-testid="git-graph-pane"]')).toBeVisible();
    await expect(app.locator(".git-graph-row").first()).toBeVisible({ timeout: 15_000 });
  });

  test("Datei im Commit öffnet den Projekt-Explorer", async ({ app, hub }) => {
    writeFileSync(join(hub.alpha, "gg-note.txt"), "from graph\n");
    execFileSync("git", ["-C", hub.alpha, "add", "gg-note.txt"]);
    execFileSync("git", ["-C", hub.alpha, "commit", "-m", "gg note"]);
    const id = await hub.createSession({ adapter: "dummy", prompt: "Datei aus Graph", workspaceMode: "direct", confirmDirty: true });
    await app.goto(`${hub.origin}/#/sessions/${id}/git`);
    await expect(app.locator(".git-graph-row").first()).toBeVisible({ timeout: 15_000 });
    // Neuester Commit aufklappen
    await app.locator(".git-graph-commit").first().click();
    await expect(app.locator('[data-testid="git-graph-files"]')).toBeVisible();
    await app.locator('[data-testid="git-graph-files"] button').filter({ hasText: "gg-note.txt" }).click();
    await expect(app.locator('[data-testid="files-sidebar"]')).toBeVisible({ timeout: 10_000 });
    await expect(app.locator('[data-testid="files-sidebar"]')).toContainText("gg-note.txt");
  });
});
