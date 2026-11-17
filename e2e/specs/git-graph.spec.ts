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
    await expect(app.locator('[data-testid=git-graph-pane]')).toBeVisible();
    await expect(app.locator(".git-graph-row").first()).toBeVisible({ timeout: 15_000 });
    // BUG-0190: Legende erklärt Spurfarben
    await expect(app.locator('[data-testid="git-graph-legend"]')).toContainText(/Spurlinien/);
  });

  test("Datei im Commit öffnet den Projekt-Explorer", async ({ app, hub }) => {
    writeFileSync(join(hub.alpha, "gg-note.txt"), "from graph\n");
    execFileSync("git", ["-C", hub.alpha, "add", "gg-note.txt"]);
    // Identität mitgeben wie in support/hub.ts makeProject: Runner ohne
    // globale Git-Konfiguration (GitHub-gehostet) lehnen den Commit sonst ab.
    execFileSync("git", ["-C", hub.alpha, "-c", "user.email=e2e@ancientvoid.local", "-c", "user.name=e2e", "commit", "-q", "-m", "gg note"]);
    const id = await hub.createSession({ adapter: "dummy", prompt: "Datei aus Graph", workspaceMode: "direct", confirmDirty: true });
    await app.goto(`${hub.origin}/#/sessions/${id}/git`);
    await expect(app.locator(".git-graph-row").first()).toBeVisible({ timeout: 15_000 });
    // Neuester Commit aufklappen
    await app.locator(".git-graph-commit").first().click();
    await expect(app.locator('[data-testid=git-graph-files]')).toBeVisible();
    await app.locator('[data-testid=git-graph-files] button').filter({ hasText: "gg-note.txt" }).click();
    await expect(app.locator('[data-testid=files-sidebar]')).toBeVisible({ timeout: 10_000 });
    await expect(app.locator('[data-testid=files-sidebar]')).toContainText("gg-note.txt");
  });

  test("BUG-0191: gelöschte Historie-Datei öffnet den Blob @ Commit", async ({ app, hub }) => {
    writeFileSync(join(hub.alpha, "gg-gone.txt"), "noch da\n");
    execFileSync("git", ["-C", hub.alpha, "add", "gg-gone.txt"]);
    execFileSync("git", ["-C", hub.alpha, "-c", "user.email=e2e@ancientvoid.local", "-c", "user.name=e2e", "commit", "-q", "-m", "gg gone add"]);
    execFileSync("git", ["-C", hub.alpha, "rm", "-q", "gg-gone.txt"]);
    execFileSync("git", ["-C", hub.alpha, "-c", "user.email=e2e@ancientvoid.local", "-c", "user.name=e2e", "commit", "-q", "-m", "gg gone del"]);
    const id = await hub.createSession({ adapter: "dummy", prompt: "Historie geloescht", workspaceMode: "direct", confirmDirty: true });
    await app.goto(`${hub.origin}/#/sessions/${id}/git`);
    await expect(app.locator(".git-graph-row").first()).toBeVisible({ timeout: 15_000 });
    // Lösch-Commit (neuester) aufklappen und Datei öffnen
    await app.locator(".git-graph-commit").first().click();
    await expect(app.locator('[data-testid="git-graph-files"]')).toBeVisible();
    await app.locator('[data-testid="git-graph-files"] button').filter({ hasText: "gg-gone.txt" }).click();
    await expect(app.locator('[data-testid="historical-blob-view"]')).toBeVisible({ timeout: 10_000 });
    await expect(app.locator('[data-testid="historical-blob-source"]')).toContainText("noch da");
    await expect(app.locator('[data-testid="historical-blob-banner"]')).toContainText(/Historie @/);
  });
});
