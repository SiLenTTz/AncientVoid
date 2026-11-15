import { test, expect, openLayer } from "../support/fixtures.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Nutzerauftrag 14.11.2026: EPIC-*.md im Dateibaum tragen einen Statuspunkt
 * (ok/warn/info/grau aus den geschützten Tokens) und den Klartext der
 * Statuszeile als Tooltip — Dateien müssen vor dem Session-Start im Projekt
 * liegen, weil der Worktree daraus entsteht. */

test.describe("Epic-Statuspunkte im Dateibaum (Nutzerauftrag 14.11.2026)", () => {
  test("EPIC-*.md zeigen Kategoriepunkt und Klartext-Tooltip; andere Dateien nicht", async ({ app, hub }) => {
    const dir = join(hub.projectsDir, "alpha", "epics");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "EPIC-P91-fertig.md"), "# EPIC-P91\n\n**Status:** abgeschlossen (2026-11-14, Gate grün)\n");
    writeFileSync(join(dir, "EPIC-P92-laufend.md"), "# EPIC-P92\n\n**Status:** in Umsetzung seit 2026-11-13\n");
    writeFileSync(join(dir, "EPIC-P93-entwurf.md"), "# EPIC-P93\n\n**Status:** Planungsentwurf · **Umsetzung:** gesperrt\n");
    writeFileSync(join(dir, "EPIC-P94-rest.md"), "# EPIC-P94\n\n**Status:** umgesetzt 2026-11-12, Live-Abnahme offen\n");
    writeFileSync(join(dir, "NOTIZ.md"), "# Notiz\n\n**Status:** abgeschlossen (darf keinen Punkt bekommen)\n");

    const id = await hub.createSession({ adapter: "dummy", prompt: "Epics" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await openLayer(app, "Dateibaum");
    await app.getByLabel("Dateiquelle").selectOption(`p:${hub.alpha}`);
    const tree = app.getByTestId("files-sidebar");
    await tree.locator('[data-path="epics"]').click();

    const done = tree.locator(".files-row").filter({ hasText: "EPIC-P91-fertig.md" });
    await expect(done.locator(".epic-dot.epic-done")).toBeVisible();
    await expect(done.locator(".epic-dot")).toHaveAttribute("title", /abgeschlossen \(2026-11-14/);
    await expect(tree.locator(".files-row").filter({ hasText: "EPIC-P92-laufend.md" }).locator(".epic-dot.epic-wip")).toBeVisible();
    await expect(tree.locator(".files-row").filter({ hasText: "EPIC-P93-entwurf.md" }).locator(".epic-dot.epic-open")).toBeVisible();
    await expect(tree.locator(".files-row").filter({ hasText: "EPIC-P94-rest.md" }).locator(".epic-dot.epic-code")).toBeVisible();
    await expect(tree.locator(".files-row").filter({ hasText: "NOTIZ.md" }).locator(".epic-dot")).toHaveCount(0);
  });
});
