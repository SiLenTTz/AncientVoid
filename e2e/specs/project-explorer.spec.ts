import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../support/fixtures.ts";
import type { Page } from "@playwright/test";
import type { TestHub } from "../support/hub.ts";

/**
 * EPIC-P46 T46.9 (Ausschnitt T46.3–T46.6): rechte Projekt-Sidebar gegen einen echten Hub —
 * lazy Baum mit dotfiles/untracked/ignoriert, Datei bis zum letzten Byte, Hex, Änderung während des Lesens,
 * Reload. Syntaxfarben/Diagnosen (T46.7) und Office/Notebook-Ansichten sind noch nicht Teil dieses Specs.
 */
async function openFiles(app: Page, hub: TestHub): Promise<void> {
  await app.getByRole("button", { name: "Dateibaum öffnen" }).click();
  await app.getByLabel("Dateiquelle").selectOption(`p:${hub.alpha}`);
  await expect(app.getByTestId("files-identity")).toContainText("Projektordner");
}

/** Abschnittsweise bis „Ende“: jeden Klick erst nach dem Laden des vorigen Abschnitts. */
async function pageToEnd(app: Page): Promise<void> {
  const range = app.getByTestId("file-pager-range");
  for (let i = 0; i < 40; i++) {
    const before = (await range.textContent()) ?? "";
    if (before.includes("Ende")) return;
    await app.getByRole("button", { name: "Nächster Abschnitt" }).click();
    await expect(range).not.toHaveText(before);
  }
  throw new Error("kein Ende erreicht");
}

test.describe("Projekt-Explorer (EPIC-P46)", () => {
  test("Baum: dotfiles und untracked sichtbar, Ignoriertes gezählt und einblendbar, tief verschachtelte Datei erreichbar @desktop", async ({ app, hub }) => {
    writeFileSync(join(hub.alpha, ".gitignore"), "node_modules/\n");
    mkdirSync(join(hub.alpha, "node_modules/pkg"), { recursive: true });
    writeFileSync(join(hub.alpha, "node_modules/pkg/index.js"), "x");
    writeFileSync(join(hub.alpha, ".versteckt"), "dot");
    writeFileSync(join(hub.alpha, "neu.txt"), "untracked");
    mkdirSync(join(hub.alpha, "a/b/c/d/e"), { recursive: true });
    writeFileSync(join(hub.alpha, "a/b/c/d/e/tief.txt"), "ganz unten\n");

    await openFiles(app, hub);
    const side = app.getByTestId("files-sidebar");
    await expect(side.locator('[data-path=".versteckt"]')).toBeVisible();
    await expect(side.locator('[data-path="neu.txt"] .files-git')).toHaveText("U");
    await expect(side.locator('[data-path=".git"]')).toBeDisabled(); // sichtbar gesperrt, nicht „leer“
    await expect(side.locator('[data-path="node_modules"]')).toHaveCount(0);
    await expect(side).toContainText("ignorierte Einträge ausgeblendet");
    await side.getByLabel("Ignoriertes").check();
    await expect(side.locator('[data-path="node_modules"] .files-git')).toHaveText("I");
    await side.getByLabel("Ignoriertes").uncheck();

    for (const dir of ["a", "a/b", "a/b/c", "a/b/c/d", "a/b/c/d/e"]) await side.locator(`[data-path="${dir}"]`).click();
    await side.locator('[data-path="a/b/c/d/e/tief.txt"]').click();
    await expect(app.getByTestId("file-text")).toContainText("ganz unten");
  });

  test("Datei > 1 MiB ist bis zum letzten Zeichen lesbar; Änderung während des Lesens wird gemeldet statt gemischt", async ({ app, hub }) => {
    const line = "Zeile mit Umlauten äöü und Emoji 😀 — Ende der Zeile\n";
    const body = line.repeat(Math.ceil((1.4 * 1024 * 1024) / Buffer.byteLength(line)));
    writeFileSync(join(hub.alpha, "gross.txt"), body + "LETZTE-ZEILE-MARKE\n");

    await openFiles(app, hub);
    const side = app.getByTestId("files-sidebar");
    await side.locator('[data-path="gross.txt"]').click();
    await expect(app.getByTestId("file-text")).toContainText("Zeile mit Umlauten äöü und Emoji 😀");
    await pageToEnd(app);
    await expect(app.getByTestId("file-text")).toContainText("LETZTE-ZEILE-MARKE");

    // Revisionsbindung: nach einer Änderung auf der Platte liefert der nächste Abschnitt keinen Mischinhalt
    await app.getByRole("button", { name: "Voriger Abschnitt" }).click();
    await expect(app.getByTestId("file-pager-range")).not.toContainText("Ende"); // Abschnitt geladen, erst dann ändern
    writeFileSync(join(hub.alpha, "gross.txt"), "ganz anders\n");
    await app.getByRole("button", { name: "Nächster Abschnitt" }).click();
    await expect(app.locator(".files-stale")).toContainText("Die Datei hat sich geändert");
    await app.getByRole("button", { name: "Neu laden" }).click();
    await expect(app.getByTestId("file-text")).toContainText("ganz anders");
  });

  test("unbekanntes Binärformat: Hex-Ansicht bis zum letzten Byte, Download möglich", async ({ app, hub }) => {
    const bytes = Buffer.alloc(9000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i & 0xff;
    writeFileSync(join(hub.alpha, "daten.bin"), bytes);

    await openFiles(app, hub);
    await app.getByTestId("files-sidebar").locator('[data-path="daten.bin"]').click();
    await expect(app.getByTestId("file-hex")).toContainText("00000000  00 01 02 03");
    await expect(app.getByRole("button", { name: "Text", exact: true })).toHaveCount(0); // kein erfundener Textmodus
    await pageToEnd(app);
    await expect(app.getByTestId("file-pager-range")).toContainText("von 9.000");
    await expect(app.getByTestId("file-hex")).toContainText("00002320  20 21 22 23 24 25 26 27"); // letzte Zeile: 8 Bytes ab 0x2320, Datei endet bei 9000
    const download = app.waitForEvent("download");
    await app.getByRole("button", { name: "Download" }).click();
    expect((await download).suggestedFilename()).toBe("daten.bin");
  });

  test("Bild: passive Vorschau; Agentenänderung erscheint im Baum; Zustand überlebt ein Neuladen", async ({ app, hub }) => {
    // 1×1 PNG
    writeFileSync(join(hub.alpha, "punkt.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64"));
    await openFiles(app, hub);
    const side = app.getByTestId("files-sidebar");
    await side.locator('[data-path="punkt.png"]').click();
    await expect(app.locator("img.file-media")).toBeVisible();
    await app.getByRole("tab", { name: "Baum" }).click();

    writeFileSync(join(hub.alpha, "vom-agenten.txt"), "neu");
    await expect(side.locator('[data-path="vom-agenten.txt"]')).toBeVisible({ timeout: 15_000 });

    await app.reload();
    await expect(app.getByTestId("files-sidebar")).toBeVisible();
    await expect(app.getByLabel("Dateiquelle")).toHaveValue(`p:${hub.alpha}`);
    await expect(app.getByRole("tab", { name: "punkt.png" })).toBeVisible();
  });
});
