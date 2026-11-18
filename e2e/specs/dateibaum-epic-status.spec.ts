import { test, expect, openLayer } from "../support/fixtures.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Nutzerauftrag 14.11.2026: EPIC-*.md im Dateibaum tragen einen Statuspunkt
 * (ok/warn/info/grau aus den geschützten Tokens) und den Klartext der
 * Statuszeile als Tooltip — Dateien müssen vor dem Session-Start im Projekt
 * liegen, weil der Worktree daraus entsteht. ADR-0089 ergänzt: blocked — Einträge,
 * deren Abnahme/Entscheid ein Mensch braucht — eigener Punkt (err) mit „H“. */

test.describe("Epic-Statuspunkte im Dateibaum (Nutzerauftrag 14.11.2026)", () => {
  test("EPIC-*.md zeigen Kategoriepunkt und Klartext-Tooltip; andere Dateien nicht", async ({ app, hub }) => {
    const dir = join(hub.projectsDir, "alpha", "epics");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "EPIC-P91-fertig.md"), "# EPIC-P91\n\n**Status:** abgeschlossen (2026-11-14, Gate grün)\n");
    writeFileSync(join(dir, "EPIC-P92-laufend.md"), "# EPIC-P92\n\n**Status:** in Umsetzung seit 2026-11-13\n");
    writeFileSync(join(dir, "EPIC-P93-entwurf.md"), "# EPIC-P93\n\n**Status:** Planungsentwurf · **Umsetzung:** gesperrt\n");
    writeFileSync(join(dir, "EPIC-P94-rest.md"), "# EPIC-P94\n\n**Status:** umgesetzt 2026-11-12, Live-Abnahme offen\n");
    writeFileSync(join(dir, "EPIC-P95-offen.md"), "# EPIC-P95\n\n**Status:** offen · **Phase:** P95\n");
    writeFileSync(join(dir, "NOTIZ.md"), "# Notiz\n\n**Status:** abgeschlossen (darf keinen Punkt bekommen)\n");
    const bugsDir = join(hub.projectsDir, "alpha", "bugs");
    mkdirSync(bugsDir, { recursive: true });
    writeFileSync(join(bugsDir, "bug-0189-offen.md"), "---\nid: BUG-0189\nstatus: open\n---\n# BUG-0189\n");
    writeFileSync(join(bugsDir, "bug-0190-laufend.md"), "---\nstatus: in-progress\n---\n# BUG-0190\n");
    writeFileSync(join(bugsDir, "bug-0191-fertig.md"), "---\nstatus: done\n---\n# BUG-0191\n");
    writeFileSync(join(bugsDir, "bug-0192-code.md"), "---\nstatus: fixed\n---\n# BUG-0192\n");
    writeFileSync(join(bugsDir, "bug-0193-mensch.md"), "---\nstatus: needs-human-acceptance\n---\n# BUG-0193\n");

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
    await expect(tree.locator(".files-row").filter({ hasText: "EPIC-P93-entwurf.md" }).locator(".epic-dot.epic-blocked")).toBeVisible();
    await expect(tree.locator(".files-row").filter({ hasText: "EPIC-P93-entwurf.md" }).locator(".epic-dot.epic-blocked")).toHaveText("H");
    await expect(tree.locator(".files-row").filter({ hasText: "EPIC-P94-rest.md" }).locator(".epic-dot.epic-blocked")).toHaveText("H");
    await expect(tree.locator(".files-row").filter({ hasText: "EPIC-P95-offen.md" }).locator(".epic-dot.epic-open")).toBeVisible();
    await expect(tree.locator(".files-row").filter({ hasText: "NOTIZ.md" }).locator(".epic-dot")).toHaveCount(0);

    // BUG-0189: bug-*.md dieselben Punkt-Tokens wie Epics (Geschwisterordner der Epics)
    await tree.locator('[data-path="bugs"]').click();
    await expect(tree.locator(".files-row").filter({ hasText: "bug-0189-offen.md" }).locator(".epic-dot.epic-open")).toBeVisible();
    await expect(tree.locator(".files-row").filter({ hasText: "bug-0190-laufend.md" }).locator(".epic-dot.epic-wip")).toBeVisible();
    await expect(tree.locator(".files-row").filter({ hasText: "bug-0191-fertig.md" }).locator(".epic-dot.epic-done")).toBeVisible();
    await expect(tree.locator(".files-row").filter({ hasText: "bug-0192-code.md" }).locator(".epic-dot.epic-code")).toBeVisible();
    await expect(tree.locator(".files-row").filter({ hasText: "bug-0193-mensch.md" }).locator(".epic-dot.epic-blocked")).toHaveText("H");
  });
});
