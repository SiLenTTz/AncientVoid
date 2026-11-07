import { test, expect } from "../support/fixtures.ts";
import type { Page } from "@playwright/test";

/** EPIC-P34 T34.6 (AC-P34-5): Schriftart/-größe mit Live-Vorschau, selbst ausgeliefert, Code bleibt Festbreite. */
const cssVar = (app: Page, name: string) => app.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
const family = (app: Page, selector: string) => app.locator(selector).first().evaluate((el) => getComputedStyle(el).fontFamily);
const size = (app: Page, selector: string) => app.locator(selector).first().evaluate((el) => getComputedStyle(el).fontSize);

async function openSettings(app: Page) {
  await app.locator(".dock").getByRole("button", { name: "Einstellungen" }).click();
  await expect(app.getByRole("heading", { name: "Schrift" })).toBeVisible();
}

test.describe("Schrift (EPIC-P34 T34.6)", () => {
  test("keine Anfrage an Fremd-Hosts, Standard bleibt JetBrains Mono bei 14/16 px", async ({ app }) => {
    const foreign: string[] = [];
    app.on("request", (r) => {
      const u = new URL(r.url());
      if (u.protocol.startsWith("http") && u.host !== new URL(app.url()).host) foreign.push(u.host);
    });
    await app.reload();
    await openSettings(app);
    expect(foreign).toEqual([]);
    expect(await family(app, "body")).toContain("JetBrains Mono");
    expect(await size(app, "body")).toBe("14px");
    // Formularfelder bleiben bei 100 % auf 16 px (kein iOS-Zoom beim Fokussieren).
    expect(
      await app.evaluate(() => {
        const el = document.body.appendChild(document.createElement("input"));
        const px = getComputedStyle(el).fontSize;
        el.remove();
        return px;
      }),
    ).toBe("16px");
  });

  test("Oberflächenschrift wirkt sofort, Code und Diff bleiben Festbreite, Reload behält die Wahl", async ({ app }) => {
    await openSettings(app);
    await app.getByRole("radiogroup", { name: "Schriftart Oberfläche" }).getByRole("radio", { name: /Inter/ }).click();
    await expect.poll(() => cssVar(app, "--font-ui")).toContain("Inter");
    expect(await family(app, "body")).toContain("Inter");
    expect(await family(app, ".preview-diff")).toContain("JetBrains Mono");
    expect(await family(app, ".preview-code")).toContain("JetBrains Mono");
    await app.reload();
    await openSettings(app);
    expect(await cssVar(app, "--font-ui")).toContain("Inter");
  });

  test("Codeschrift bietet nur Festbreitenschriften und gilt für die Vorschau", async ({ app }) => {
    await openSettings(app);
    const group = app.getByRole("radiogroup", { name: "Schriftart Code" });
    await expect(group.getByRole("radio", { name: /Inter/ })).toHaveCount(0);
    await group.getByRole("radio", { name: /IBM Plex Mono/ }).click();
    await expect.poll(() => family(app, ".preview-diff")).toContain("IBM Plex Mono");
  });

  test("Schriftgröße per Stepper, Grenzen, Zurücksetzen auf 100 %", async ({ app }) => {
    await openSettings(app);
    await app.getByRole("button", { name: "Schriftgröße erhöhen" }).click();
    await expect(app.locator(".font-scale-value")).toHaveText("105 %");
    await expect.poll(() => size(app, "body")).toBe("14.7px");
    await app.getByRole("button", { name: "Schriftgröße zurücksetzen" }).click();
    await expect(app.locator(".font-scale-value")).toHaveText("100 %");
    expect(await size(app, "body")).toBe("14px");
    for (let i = 0; i < 3; i++) await app.getByRole("button", { name: "Schriftgröße verringern" }).click();
    await expect(app.locator(".font-scale-value")).toHaveText("85 %");
    await expect(app.getByRole("button", { name: "Schriftgröße verringern" })).toBeDisabled();
  });

  test("Zurücksetzen in der Vorschau stellt Standardwerte her", async ({ app }) => {
    await openSettings(app);
    await app.getByRole("radiogroup", { name: "Schriftart Oberfläche" }).getByRole("radio", { name: /Inter/ }).click();
    await app.locator(".settings-preview").getByRole("button", { name: "Zurücksetzen" }).click();
    await expect.poll(() => cssVar(app, "--font-ui")).toContain("JetBrains Mono");
  });
});
