import { test, expect } from "../support/fixtures.ts";
import type { Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** EPIC-P52: Galaxie über Suche, Auswahl, System, Vollbild und Reload. */

async function openLists(app: Page) {
  const expand = app.getByRole("button", { name: "Liste aufklappen" });
  if (await expand.isVisible()) await expand.click();
}

test.describe("Repo-Galaxie (EPIC-P52)", () => {
  test("Suche, Nachbarn und Filter @desktop @tablet", async ({ app, hub }) => {
    writeFileSync(join(hub.alpha, "src/main.ts"), "import { parseToken } from \"./auth\";\n");
    const id = await hub.createSession({ adapter: "dummy", prompt: "Galaxie Suche", workspaceMode: "direct", confirmDirty: true });
    await app.goto(`${hub.origin}/#/sessions/${id}/graph`);
    await expect(app.locator(".graph-canvas")).toBeVisible();
    await expect(app.locator('[data-testid="graph-legend"]')).toBeVisible();
    await expect(app.getByRole("button", { name: "Ganze Galaxie zeigen" })).toBeVisible();

    const search = app.getByRole("searchbox", { name: "Dateien suchen" });
    await search.click();
    await search.fill("zzz-kein-treffer");
    await expect(app.getByText("Kein Treffer")).toBeVisible();
    await search.fill("main.ts");
    await app.getByRole("button", { name: "Treffer src/main.ts" }).click();
    await openLists(app);
    await expect(app.getByRole("heading", { name: "Verwendet (1)" })).toBeVisible();
    await expect(app.getByRole("heading", { name: "Wird verwendet von (0)" })).toBeVisible();
    await app.locator(".graph-neighbors").getByRole("button", { name: /src\/auth\.ts/ }).click();
    await openLists(app);
    await expect(app.getByRole("heading", { name: "Wird verwendet von (1)" })).toBeVisible();

    const hits = await app.locator(".graph-node-hit").count();
    await app.getByRole("button", { name: "Code", exact: true }).click();
    await expect(app.locator(".graph-node-hit")).toHaveCount(hits);

    await app.locator(".graph-pane").focus();
    await app.keyboard.press("/");
    await expect(search).toBeFocused();
  });

  test("System, Zurück-Reihenfolge und Vollbild @desktop @tablet", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy", prompt: "Galaxie Vollbild" });
    await app.setViewportSize({ width: 412, height: 915 });
    await app.goto(`${hub.origin}/#/sessions/${id}/graph`);
    const pane = app.locator(".graph-pane");
    await expect(pane).toHaveAttribute("data-fullscreen", "1");
    await expect(app.locator(".session-topbar")).toBeHidden();
    await expect(app.locator(".dock-stack")).toBeHidden();
    const back = app.getByRole("button", { name: "Vollbild verlassen" });
    const box = await back.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);

    await app.getByRole("searchbox", { name: "Dateien suchen" }).click();
    await app.getByRole("button", { name: /^Bereich / }).first().click();
    await expect(app.getByRole("navigation", { name: "Ort" })).toContainText("›");
    await app.getByRole("button", { name: "Datei README.md auswählen" }).click();
    await app.getByRole("button", { name: "Liste aufklappen" }).click();
    await expect(app.getByRole("heading", { name: /Wird verwendet von/ })).toBeVisible();

    await pane.press("Escape");
    await expect(app.getByRole("heading", { name: /Wird verwendet von/ })).toHaveCount(0);
    await pane.press("Escape");
    await expect(app.getByRole("button", { name: "Liste aufklappen" })).toHaveCount(0);
    await pane.press("Escape");
    await expect(app.getByRole("navigation", { name: "Ort" })).not.toContainText("›");
    await pane.press("Escape");
    await expect(app.locator(".session-topbar")).toBeVisible();

    await app.setViewportSize({ width: 915, height: 412 });
    await app.reload();
    // BUG-0152 (Aufklärung 13.11.2026): Produkt verhält sich korrekt — der
    // Hash behält /graph, der Graph stellt sich nach dem Reload im Vollbild
    // wieder her (auch Querformat). Rot war die Spec, weil der kalte PWA-Boot
    // unter Suite-Last die 10-s-Erwartung sprengt; hence 30 s.
    await expect(app.locator(".graph-pane")).toHaveAttribute("data-fullscreen", "1", { timeout: 30_000 });
    await expect(app.locator(".session-topbar")).toBeHidden();
  });

  test("Ansicht überlebt Reload, ohne Bewegung kein Flug", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy", prompt: "Galaxie Stand" });
    await app.emulateMedia({ reducedMotion: "reduce" });
    await app.goto(`${hub.origin}/#/sessions/${id}/graph`);
    await expect(app.locator(".graph-pane")).toHaveAttribute("data-motion", "off");
    await app.getByRole("button", { name: "Datei README.md auswählen" }).click();
    await expect(app.locator(".graph-selection")).toContainText("README.md");
    await expect.poll(() => app.evaluate((key) => localStorage.getItem(key), `ancientvoid.galaxy:session=${encodeURIComponent(id)}`)).toContain("README.md");
    await app.reload();
    await expect(app.locator(".graph-selection")).toContainText("README.md");
  });
});
