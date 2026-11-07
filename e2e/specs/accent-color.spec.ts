import { test, expect } from "../support/fixtures.ts";
import type { Page } from "@playwright/test";

/** EPIC-P34 T34.5 (AC-P34-4): Akzentfarbe per Farbwähler-Modal, live, je Theme, mit exaktem Zurücksetzen. */
const accent = (app: Page) => app.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
const stored = (app: Page) => app.evaluate(() => localStorage.getItem("ancientvoid.appearance"));

async function openPicker(app: Page) {
  await app.locator(".dock").getByRole("button", { name: "Einstellungen" }).click();
  await app.getByRole("button", { name: /Akzentfarbe wählen/ }).click();
  const dialog = app.getByRole("dialog", { name: /Akzentfarbe/ });
  await expect(dialog).toBeVisible();
  return dialog;
}

const hsvOf = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  return { s: max === 0 ? 0 : ((max - Math.min(r, g, b)) / max) * 100, v: max * 100 };
};

test.describe("Akzentfarbe (EPIC-P34 T34.5)", () => {
  test("live beim Tippen, Abbrechen stellt exakt den alten Zustand her, nichts wird gespeichert", async ({ app }) => {
    expect(await accent(app)).toBe("#ff9a3c");
    const dialog = await openPicker(app);
    await dialog.getByLabel("Hex", { exact: true }).fill("#33aaff");
    await expect.poll(() => accent(app)).toBe("#33aaff");
    // Der Text auf der Akzentfläche bleibt lesbar: helle Farbe → schwarze Schrift.
    expect(await app.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent-ink").trim())).toBe("#000000");
    await dialog.getByRole("button", { name: "Abbrechen" }).click();
    await expect(dialog).toHaveCount(0);
    expect(await accent(app)).toBe("#ff9a3c");
    expect(await stored(app)).toBeNull();
    expect(await app.evaluate(() => document.documentElement.style.getPropertyValue("--accent"))).toBe("");
  });

  test("Übernehmen speichert, überlebt den Reload und lässt Status-Farben unberührt", async ({ app }) => {
    const dialog = await openPicker(app);
    await dialog.getByRole("button", { name: "Vorgabe #a78bfa" }).click();
    await dialog.getByRole("button", { name: "Übernehmen" }).click();
    await expect(dialog).toHaveCount(0);
    expect(JSON.parse((await stored(app))!).accent.dark).toBe("#a78bfa");
    await app.reload();
    expect(await accent(app)).toBe("#a78bfa");
    expect(await app.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ok").trim())).toBe("#4fe0ab");
    expect(await app.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--err").trim())).toBe("#ff5c6a");
  });

  test("Dunkel und Hell behalten eigene Werte", async ({ app }) => {
    let dialog = await openPicker(app);
    await dialog.getByLabel("Hex", { exact: true }).fill("#4da3ff");
    await dialog.getByRole("button", { name: "Übernehmen" }).click();
    await app.locator(".segmented").getByRole("button", { name: "Hell" }).click();
    expect(await accent(app), "Hell hat noch den Standard").toBe("#d9601a");
    dialog = await app.getByRole("button", { name: /Akzentfarbe wählen/ }).click().then(() => app.getByRole("dialog", { name: /Akzentfarbe/ }));
    await expect(dialog).toContainText("Hell");
    await dialog.getByLabel("Hex", { exact: true }).fill("#1d6fd6");
    await dialog.getByRole("button", { name: "Übernehmen" }).click();
    expect(await accent(app)).toBe("#1d6fd6");
    await app.locator(".segmented").getByRole("button", { name: "Dunkel" }).click();
    expect(await accent(app), "Dunkel behält seinen Wert").toBe("#4da3ff");
  });

  test("„Standard“ nimmt den Wert zurück; „Alt“ stellt den Ausgangswert innerhalb des Dialogs wieder her", async ({ app }) => {
    let dialog = await openPicker(app);
    await dialog.getByRole("button", { name: "Vorgabe #f472b6" }).click();
    await dialog.getByRole("button", { name: "Übernehmen" }).click();
    expect(await accent(app)).toBe("#f472b6");
    dialog = await app.getByRole("button", { name: /Akzentfarbe wählen/ }).click().then(() => app.getByRole("dialog", { name: /Akzentfarbe/ }));
    await dialog.getByLabel("Hex", { exact: true }).fill("#00ff00");
    await expect.poll(() => accent(app)).toBe("#00ff00");
    await dialog.getByRole("button", { name: "Alte Farbe wiederherstellen" }).click();
    await expect.poll(() => accent(app)).toBe("#f472b6");
    await dialog.getByRole("button", { name: "Standard", exact: true }).click();
    await dialog.getByRole("button", { name: "Übernehmen" }).click();
    expect(await accent(app)).toBe("#ff9a3c");
    expect(await stored(app)).toBeNull();
  });

  test("Fläche und Farbton per Maus, Pfeiltasten und die Felder bleiben in Einklang", async ({ app }) => {
    const dialog = await openPicker(app);
    const hex = dialog.getByLabel("Hex", { exact: true });
    const plane = dialog.getByRole("slider", { name: "Sättigung und Helligkeit" });
    const box = (await plane.boundingBox())!;
    // 8 px innerhalb der Ecken: die Fläche hat abgerundete Ecken, dort träfe der Klick den Dialog dahinter.
    await plane.click({ position: { x: box.width - 8, y: 8 } });
    const corner = hsvOf(await hex.inputValue());
    expect(corner.s, "rechts ist voll gesättigt").toBeGreaterThan(94);
    expect(corner.v, "oben ist hell").toBeGreaterThan(94);
    await plane.click({ position: { x: 8, y: box.height - 8 } });
    expect(hsvOf(await hex.inputValue()).v, "unten ist schwarz").toBeLessThan(8);
    await plane.click({ position: { x: box.width / 2, y: box.height / 2 } });
    const before = await hex.inputValue();
    await plane.press("ArrowRight");
    await plane.press("ArrowRight");
    expect(await hex.inputValue()).not.toBe(before);
    const hue = dialog.getByRole("slider", { name: "Farbton" });
    const hueBox = (await hue.boundingBox())!;
    await hue.click({ position: { x: 2, y: hueBox.height / 2 } });
    await expect(dialog.getByLabel("H", { exact: true })).toHaveValue(/^[0-4]$/);
    // RGB-Feld und Hex hängen zusammen.
    await dialog.getByLabel("R", { exact: true }).fill("255");
    await dialog.getByLabel("G", { exact: true }).fill("0");
    await dialog.getByLabel("B", { exact: true }).fill("0");
    await expect(hex).toHaveValue("#ff0000");
  });

  test("zu wenig Kontrast wird als Hinweis genannt, die Wahl bleibt möglich", async ({ app }) => {
    const dialog = await openPicker(app);
    await dialog.getByLabel("Hex", { exact: true }).fill("#15161a");
    await expect(dialog.getByRole("status")).toContainText("Wenig Kontrast");
    await expect(dialog.getByRole("button", { name: "Übernehmen" })).toBeEnabled();
    await dialog.getByLabel("Hex", { exact: true }).fill("#ff9a3c");
    await expect(dialog.getByRole("status")).toHaveCount(0);
    // Ungültige Eingabe ändert die Seite nicht und sperrt Übernehmen.
    await dialog.getByLabel("Hex", { exact: true }).fill("kein-hex");
    await expect(dialog.getByRole("button", { name: "Übernehmen" })).toBeDisabled();
    expect(await accent(app)).toBe("#ff9a3c");
  });

  test("Esc schließt nur den Dialog und stellt zurück, die Werkzeugfläche bleibt offen @desktop", async ({ app }) => {
    await app.setViewportSize({ width: 1440, height: 900 });
    await app.reload();
    const dialog = await openPicker(app);
    await dialog.getByLabel("Hex", { exact: true }).fill("#33aaff");
    await app.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(app.locator(".tool-pane")).toBeVisible();
    expect(await accent(app)).toBe("#ff9a3c");
    expect(await stored(app)).toBeNull();
  });

  test("zuletzt benutzte Farben erscheinen beim nächsten Öffnen", async ({ app }) => {
    let dialog = await openPicker(app);
    await dialog.getByLabel("Hex", { exact: true }).fill("#12ab34");
    await dialog.getByRole("button", { name: "Übernehmen" }).click();
    dialog = await app.getByRole("button", { name: /Akzentfarbe wählen/ }).click().then(() => app.getByRole("dialog", { name: /Akzentfarbe/ }));
    await expect(dialog.getByRole("button", { name: "Zuletzt #12ab34" })).toBeVisible();
  });
});
