import { test, expect, cardAction } from "../support/fixtures.ts";
import { writeFileSync } from "node:fs";
import { join } from "node:path";


/** EPIC-P48 (ADR-0062): Repo-Graph im Chat-Fenster, Diagnose-Rot, Datei-Tab, Popouts. */

test.describe("Repo-Graph (EPIC-P48)", () => {
  test("Karten-Knopf öffnet die Session direkt im Graph-Tab (Hash bleibt stehen)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy", prompt: "Graph Auftrag" });
    await app.goto(`${hub.origin}/#/`);
    await cardAction(app.locator(".session-card").filter({ hasText: "Graph Auftrag" }), "Repo-Graph");
    await expect(app).toHaveURL(new RegExp(`#/sessions/${id}/graph$`));
    await expect(app.locator(".session-live[data-tab='graph']")).toBeVisible();
    await expect(app.locator(".graph-canvas")).toBeVisible();
    await expect(app.locator('[data-testid=graph-legend]')).toBeVisible();
    // Reload landet wieder im Graph-Tab (Hash-Routing).
    await app.reload();
    await expect(app.locator(".session-live[data-tab='graph']")).toBeVisible();
  });

  test("Knoten-Klick öffnet die Datei im Datei-Tab, Markdown gerendert", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy", prompt: "Knoten" });
    await app.goto(`${hub.origin}/#/sessions/${id}/graph`);
    await expect(app.locator(".graph-node-hit").first()).toBeVisible();
    await app.getByRole("button", { name: "Datei README.md auswählen" }).click();
    await app.getByRole("button", { name: "Datei öffnen" }).click();
    await expect(app.locator(".session-live[data-tab='datei']")).toBeVisible();
    await expect(app.getByText("Das Handbuch beschreibt den Handoff")).toBeVisible();
    // Hash trägt den Datei-Tab — Back/Reload bleibt nachvollziehbar.
    await expect(app).toHaveURL(new RegExp(`#/sessions/${id}/datei/README\\.md$`));
  });

  // BUG-0229: Ziehen verschiebt die Karte (Maus wie Finger) statt auszuwählen —
  // das Hit-Overlay stand flächig über dem Canvas und schluckte Pan/Tap.
  test("Ziehen am Stern verschiebt die Karte, statt die Datei auszuwählen", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy", prompt: "Pan Auftrag" });
    await app.goto(`${hub.origin}/#/sessions/${id}/graph`);
    const star = app.locator(".graph-node-hit").first();
    await expect(star).toBeVisible();
    const key = `ancientvoid.galaxy:session=${id}`;
    const readTx = () => app.evaluate((k) => (JSON.parse(localStorage.getItem(k) ?? "{}") as { camera?: { tx?: number } }).camera?.tx ?? null, key);
    const before = await readTx();
    const box = await star.boundingBox();
    await app.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await app.mouse.down();
    await app.mouse.move(box!.x + box!.width / 2 + 90, box!.y + box!.height / 2 + 60, { steps: 6 });
    await app.mouse.up();
    // Pan statt Klick: keine Auswahl, und die Kamera ist um die Ziehstrecke gewandert.
    await expect(app.locator("[data-testid=graph-selection]")).toHaveCount(0);
    await expect.poll(async () => (await readTx()) - before).toBeGreaterThan(50);
  });

  // BUG-0230: Vollbild braucht einen beschrifteten, auffindbaren Rückweg — „←“ allein war keiner.
  test("Vollbild zeigt beschrifteten Schließen-Knopf und kehrt damit zurück @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy", prompt: "Vollbild Auftrag" });
    await app.goto(`${hub.origin}/#/sessions/${id}/graph`);
    await expect(app.locator(".graph-canvas")).toBeVisible();
    if ((await app.locator(".graph-pane").getAttribute("data-fullscreen")) !== "1") {
      await app.getByRole("button", { name: "Vollbild", exact: true }).click();
    }
    await expect(app.locator(".graph-pane[data-fullscreen='1']")).toBeVisible();
    const close = app.locator(".graph-fullclose");
    await expect(close).toBeVisible();
    await expect(close).toHaveText(/Vollbild verlassen/);
    await close.click();
    await expect(app.locator(".graph-pane[data-fullscreen='0']")).toBeVisible();
  });

  test("Prüfen: JSON-Fehler markiert die Datei rot, Gegenprobe wird wieder normal", async ({ app, hub }) => {
    writeFileSync(join(hub.alpha, "kaputt.json"), "{\n");
    const id = await hub.createSession({ adapter: "dummy", prompt: "Diagnose", workspaceMode: "direct", confirmDirty: true });
    await app.goto(`${hub.origin}/#/sessions/${id}/graph`);
    await app.getByRole("button", { name: "Graph prüfen" }).click();
    await expect(app.locator(".graph-node-hit.has-error")).toHaveCount(1);
    // Gegenprobe: reparieren und erneut prüfen — nie rot bleiben.
    writeFileSync(join(hub.alpha, "kaputt.json"), "{}\n");
    await app.getByRole("button", { name: "Graph prüfen" }).click();
    await expect(app.locator(".graph-node-hit.has-error")).toHaveCount(0);
  });

  test("Graph und Datei lassen sich als eigene Fenster herauslösen, Knoten im Graph-Fenster öffnet Datei-Fenster @desktop", async ({ app, hub, context }) => {
    await app.setViewportSize({ width: 1440, height: 900 });
    const id = await hub.createSession({ adapter: "opencode", prompt: "Fenster Graph" });
    await app.goto(`${hub.origin}/#/sessions/${id}/graph`);
    await expect(app.locator(".graph-canvas")).toBeVisible();

    let popupP = context.waitForEvent("page");
    await app.getByRole("button", { name: "Graph in eigenes Fenster" }).click();
    const graphWin = await popupP;
    await graphWin.waitForLoadState();
    expect(graphWin.url()).toContain("window=1");
    expect(graphWin.url()).toContain(`/sessions/${id}/graph`);
    expect(graphWin.url()).not.toMatch(/token/i);
    await expect(graphWin.locator(".graph-canvas")).toBeVisible();
    // Schlanke Hülle wie jede eigene Fläche: kein Dock, keine Liste, keine Kachel-Leiste.
    await expect(graphWin.locator(".dock, .split-list, .tile-bar")).toHaveCount(0);

    // Knoten im Graph-Fenster → die Datei bekommt ihr eigenes Fenster.
    popupP = context.waitForEvent("page");
    await graphWin.getByRole("button", { name: "Datei README.md auswählen" }).click();
    await graphWin.getByRole("button", { name: "Datei öffnen" }).click();
    const fileWin = await popupP;
    await fileWin.waitForLoadState();
    expect(fileWin.url()).toContain(`/sessions/${id}/datei/README.md`);
    await expect(fileWin.getByText("Das Handbuch beschreibt den Handoff")).toBeVisible();

    // Hauptfenster: Datei-Tab direkt herauslösen — das Ziel existiert schon
    // (aus dem Graph-Fenster): es kommt nach vorn statt doppelt zu entstehen.
    await app.getByRole("button", { name: "Datei README.md auswählen" }).click();
    await app.getByRole("button", { name: "Datei öffnen" }).click();
    await expect(app.locator(".session-live[data-tab='datei']")).toBeVisible();
    await app.getByRole("button", { name: "Datei in eigenes Fenster" }).click();
    await expect(fileWin.locator("html")).toHaveAttribute("data-focus-requests", "1");
  });

  // BUG-0128: Herauslösen bündelt Baum und alle offenen Dateien in genau einem Fenster (nie Einzeldateien).
  test("Datei-Tab der rechten Datei-Seitenleiste lässt sich herauslösen (T46.8-Rest) @desktop", async ({ app, hub, context }) => {
    await app.setViewportSize({ width: 1440, height: 900 });
    const id = await hub.createSession({ adapter: "dummy", prompt: "Seitenleiste" });
    await app.goto(`${hub.origin}/#/sessions/${id}/graph`);
    await expect(app.locator(".graph-canvas")).toBeVisible();
    // Strg+Umschalt+E öffnet die rechte Sidebar; erst Nutzung schlägt die fokussierte Session als Quelle vor.
    await app.keyboard.press("Control+Shift+e");
    await expect(app.locator('[data-testid=files-sidebar]')).toBeVisible();
    await app.locator(".files-row").filter({ hasText: "README.md" }).click();
    await expect(app.locator('[data-testid=files-sidebar] .files-tab')).toHaveCount(1);
    const popupP = context.waitForEvent("page");
    await app.locator(".files-tab-popout").click();
    const popup = await popupP;
    await popup.waitForLoadState();
    expect(popup.url()).toContain("#/dateibaum");
    await expect(popup.getByText("Das Handbuch beschreibt den Handoff")).toBeVisible();
  });
});
