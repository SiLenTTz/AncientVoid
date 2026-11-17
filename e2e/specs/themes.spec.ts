import type { Locator, Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, sessionTab, openLayer } from "../support/fixtures.ts";
import type { TestHub } from "../support/hub.ts";

/**
 * EPIC-P63 T63.2 (BUG-0187) / AC-P63-2: Diff-Review, Dateien-Schublade und
 * Arbeitsort trugen Geister-Tokens mit fremder Fallback-Palette — im hellen
 * Thema blieben sie dunkel. Dieser Spec vergleicht die berechneten Farben der
 * Flächen in beiden Themen mit den aufgelösten Design-Tokens (kein Pixel-
 * Vergleich: Antialiasing unterscheidet sich zwischen Rechnern) und hängt
 * Screenshots beider Themen als Beleg an.
 */

async function tokenColor(page: Page, cssVar: string): Promise<string> {
  return page.evaluate((v) => {
    const probe = document.createElement("div");
    probe.style.color = `var(${v})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, cssVar);
}

async function expectTokenStyle(page: Page, el: Locator, prop: "backgroundColor" | "borderTopColor" | "color", token: string, where: string) {
  const [actual, expected] = await Promise.all([el.evaluate((n, p) => getComputedStyle(n)[p], prop), tokenColor(page, token)]);
  expect(actual, `${where}: ${prop} entspricht ${token}`).toBe(expected);
}

async function setTheme(app: Page, origin: string, theme: "dark" | "light") {
  await app.goto(`${origin}/#/einstellungen`);
  const group = app.getByRole("group", { name: "Erscheinungsbild", exact: true });
  await group.getByRole("button", { name: theme === "light" ? "Hell" : "Dunkel", exact: true }).click();
  await expect(app.locator("html")).toHaveAttribute("data-theme", theme);
}

function makeFactoryProject(hub: TestHub): string {
  const project = join(hub.projectsDir, "p63-factory");
  mkdirSync(join(project, ".factory", "intake"), { recursive: true });
  writeFileSync(join(project, ".factory", "config.json"), "{}\n");
  writeFileSync(join(project, ".factory", "intake", "state.json"), JSON.stringify({ schema_version: "1", status: "intake", execution_ready: false, next_action: "erste Aufgabe festlegen" }));
  execSync("git init -q", { cwd: project });
  return project;
}

test.describe("Themes folgen den Tokens (BUG-0187)", () => {
  test("Diff, Dateien, Arbeitsort, Graph, Loops, Settings tragen Token-Farben in beiden Themes", async ({ app, hub }, info) => {
    test.setTimeout(240_000);
    // Epic-Punkt im Baum braucht eine EPIC-*.md im Projekt (Muster: dateibaum-epic-status.spec.ts).
    const epicDir = join(hub.projectsDir, "alpha", "epics");
    mkdirSync(epicDir, { recursive: true });
    writeFileSync(join(epicDir, "EPIC-P63-themes.md"), "# EPIC-P63\n\n**Status:** abgeschlossen\n");

    const id = await hub.createSession({ adapter: "opencode", prompt: "Lege eine DATEI an" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "Zug fertig");
    const loopId = await hub.createSession({ adapter: "loop:securesight-factory", project: makeFactoryProject(hub) });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".session-live, .tile").first()).toBeVisible();

    for (const theme of ["dark", "light"] as const) {
      await setTheme(app, hub.origin, theme);

      // Diff-Review: Hunk-Karte trägt Kartenfläche und Chip-Rand aus Tokens.
      await app.goto(`${hub.origin}/#/sessions/${id}`);
      await sessionTab(app, "Änderungen");
      const hunk = app.locator(".hunk-card").first();
      await expect(hunk).toBeVisible();
      await expectTokenStyle(app, hunk, "backgroundColor", "--bg-elev", `Diff ${theme}`);
      await expectTokenStyle(app, hunk, "borderTopColor", "--bg-chip", `Diff ${theme}`);
      await app.screenshot({ path: info.outputPath(`p63-diff-${theme}.png`) });

      // Dateien-Schublade: Hintergrund war --bg-card #151515 (Geister-Token).
      await openLayer(app, "Dateibaum");
      await app.getByLabel("Dateiquelle").selectOption(`p:${hub.alpha}`);
      const sidebar = app.getByTestId("files-sidebar");
      await expect(sidebar).toBeVisible();
      await expectTokenStyle(app, sidebar, "backgroundColor", "--bg-elev", `Dateien ${theme}`);
      await sidebar.locator('[data-path="epics"]').click();
      const done = sidebar.locator(".files-row").filter({ hasText: "EPIC-P63-themes.md" }).locator(".epic-dot.epic-done");
      await expectTokenStyle(app, done, "backgroundColor", "--ok", `Epic-Punkt ${theme}`);
      await app.screenshot({ path: info.outputPath(`p63-dateien-${theme}.png`) });
      await app.getByLabel("Dateien schließen").click(); // Drawer blockiert sonst die folgende Navigation

      // Arbeitsort-Auswahl: Rahmen war --border #2a2f3a (Geister-Token).
      await app.goto(`${hub.origin}/#/neu`);
      await app.getByLabel("Adapter").selectOption("dummy");
      const choice = app.locator(".workplace-choice");
      await expect(choice).toBeVisible();
      await expectTokenStyle(app, choice, "borderTopColor", "--border", `Arbeitsort ${theme}`);
      await expectTokenStyle(app, choice.locator(".workplace-card:not(.active)").first(), "borderTopColor", "--border", `Arbeitsort-Karte ${theme}`);
      await app.screenshot({ path: info.outputPath(`p63-arbeitsort-${theme}.png`) });

      // Graph der Session (EPIC-P48): Fläche und Sterne aus Tokens.
      await app.goto(`${hub.origin}/#/sessions/${id}/graph`);
      await app.locator(".graph-pane, .tile").first().waitFor({ state: "visible" });
      await app.screenshot({ path: info.outputPath(`p63-graph-${theme}.png`) });

      // Loop-Beobachter: Panel-Rahmen war --border (Geister-Token).
      await app.goto(`${hub.origin}/#/sessions/${loopId}`);
      const loopPanel = app.locator(".loop-panel").first();
      await expect(loopPanel).toBeVisible();
      await expectTokenStyle(app, loopPanel, "borderTopColor", "--border", `Loops ${theme}`);
      await app.screenshot({ path: info.outputPath(`p63-loops-${theme}.png`) });

      // Einstellungen: Sektion trägt Kartenfläche.
      await app.goto(`${hub.origin}/#/einstellungen`);
      const section = app.locator(".settings-section").first();
      await expect(section).toBeVisible();
      await expectTokenStyle(app, section, "backgroundColor", "--bg-elev", `Settings ${theme}`);
      await app.screenshot({ path: info.outputPath(`p63-settings-${theme}.png`) });
    }
  });
});
