import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../support/fixtures.ts";
import type { TestHub } from "../support/hub.ts";

function externalClaude(hub: TestHub, project: string, ids: string[]): string {
  const dir = join(hub.root, "claude", "projects", project);
  mkdirSync(dir, { recursive: true });
  for (const id of ids) writeFileSync(join(dir, `${id}.jsonl`), `{"type":"user","sessionId":"${id}"}\n`);
  return dir;
}

test.describe("Gefundene Sessions (T5.3, AC-P5-1)", () => {
  test("Hub- und externe Sessions erscheinen einmal, mit Herkunft und unbekanntem Format @desktop", async ({ app, hub }) => {
    const own = await hub.createSession({ adapter: "dummy" });
    await hub.createSession({ adapter: "dummy", project: hub.beta });
    const dir = externalClaude(hub, "-home-user-extern", ["ext-1", "ext-2"]);
    externalClaude(hub, "-home-user-kopie", ["ext-1"]);
    mkdirSync(join(dir, "ext-2", "subagents"), { recursive: true });
    writeFileSync(join(dir, "ext-2", "subagents", "agent-9.jsonl"), "{}\n");
    writeFileSync(join(dir, "notizen.txt"), "kein Transkript\n");

    await app.getByRole("button", { name: "Gefunden" }).click();
    await expect(app.getByText("6 gefunden")).toBeVisible();
    await expect(app.getByText("1 unbekanntes Format")).toBeVisible();
    const rows = app.locator(".discovered-row");
    await expect(rows.filter({ hasText: "ext-1" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "agent-9" }).getByText("Subagent von ext-2")).toBeVisible();
    await expect(rows.filter({ hasText: "extern · nur beobachtet" })).toHaveCount(4);
    await expect(rows.filter({ hasText: "Hub" }).filter({ hasNotText: "extern" })).toHaveCount(2);

    await rows.filter({ hasText: own }).locator(".session-open").click();
    await expect(app).toHaveURL(new RegExp(`#/sessions/${own}`));
    await expect(app.locator(".topbar")).toContainText("dummy");
  });

  test("AC-P5-1: 20 Sessions, je zwei pro Projekt, sind binnen 10 s vollständig sichtbar", async ({ app, hub }, info) => {
    for (const project of [hub.alpha, hub.beta]) for (let i = 0; i < 5; i++) await hub.createSession({ adapter: "dummy", project });
    for (let p = 1; p <= 5; p++) externalClaude(hub, `-home-user-extern-${p}`, [`ext-${p}-a`, `ext-${p}-b`]);
    const t0 = Date.now();
    await app.getByRole("button", { name: "Gefunden" }).click();
    await expect(app.getByText("20 gefunden")).toBeVisible({ timeout: 10_000 });
    await expect(app.locator(".discovered-row")).toHaveCount(20);
    info.annotations.push({ type: "sichtbar nach ms", description: String(Date.now() - t0) });
    expect(Date.now() - t0).toBeLessThan(10_000);
    await expect(app.locator(".project-tile")).toHaveCount(7);
  });

  test("mehr als eine Seite wird mit „Mehr laden“ vollständig", async ({ app, hub }) => {
    externalClaude(hub, "-home-user-viele", Array.from({ length: 55 }, (_, i) => `viele-${i}`));
    await app.getByRole("button", { name: "Gefunden" }).click();
    await expect(app.locator(".discovered-row")).toHaveCount(50);
    await app.getByRole("button", { name: "Mehr laden" }).click();
    await expect(app.locator(".discovered-row")).toHaveCount(55);
    await expect(app.getByRole("button", { name: "Mehr laden" })).toHaveCount(0);
  });

  test("die Status-Seite zeigt das Harness-Inventar mit geprüfter Version (T5.1)", async ({ app }) => {
    await app.getByRole("button", { name: "Status" }).click();
    const row = app.locator(".inventory-table tr").filter({ hasText: "opencode" });
    await expect(row).toContainText("1.2.3-e2e");
    await expect(row.locator(".support").first()).toHaveText("fehlt");
    await expect(row.locator(".support").nth(1)).toHaveText("gebaut, unbelegt");
    await expect(app.locator(".inventory-table tr").filter({ hasText: "deepseek" })).toContainText("blockiert");
  });
});
