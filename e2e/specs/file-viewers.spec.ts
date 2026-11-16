import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync, strToU8 } from "fflate";
import { test, expect, openLayer } from "../support/fixtures.ts";
import type { Page } from "@playwright/test";
import type { TestHub } from "../support/hub.ts";

/**
 * EPIC-P46 T46.6/T46.7/T46.9 (ADR-0058 §7–§8): Zeilennummern + Syntaxfarben, Zeilensprung, Suche über die ganze
 * Datei, strukturierte Ansichten (Markdown/JSON/CSV/Notebook/SVG/HTML/ZIP/Office), UTF-16. Sicherheitsprüfung:
 * eingebettete Skripte laufen in keiner Ansicht.
 */
async function openFile(app: Page, hub: TestHub, path: string): Promise<void> {
  if (!(await app.getByTestId("files-sidebar").isVisible().catch(() => false))) await openLayer(app, "Dateibaum");
  await app.getByLabel("Dateiquelle").selectOption(`p:${hub.alpha}`);
  const side = app.getByTestId("files-sidebar");
  const parts = path.split("/");
  for (let i = 1; i < parts.length; i++) await side.locator(`[data-path="${parts.slice(0, i).join("/")}"]`).click();
  await side.locator(`[data-path="${path}"]`).click();
}

const view = (app: Page, name: string) => app.getByRole("group", { name: "Ansicht" }).getByRole("button", { name, exact: true });

test.describe("Datei-Ansichten (EPIC-P46)", () => {
  test("Text: Zeilennummern, Syntaxfarben, Zeilensprung und Suche über die ganze Datei @desktop", async ({ app, hub }) => {
    const filler = Array.from({ length: 9000 }, (_, i) => `// füllzeile ${i + 1} mit etwas Text damit die Datei mehrere Abschnitte hat`).join("\n");
    writeFileSync(join(hub.alpha, "gross.ts"), `export const kopf: number = 1;\n${filler}\nexport function ziel(): string { return "NADELSPITZE"; }\n`);
    await openFile(app, hub, "gross.ts");
    const code = app.getByTestId("file-text");
    await expect(code.locator('[data-line="1"] .file-ln')).toHaveText("1");
    await expect(app.getByTestId("file-nocolor")).toBeVisible(); // Abschnitt > 120k Zeichen: ehrlich ungefärbt

    await app.getByLabel("Zu Zeile springen").fill("9000");
    await app.getByLabel("Zu Zeile springen").press("Enter");
    await expect(app.locator('[data-line="9000"]')).toHaveClass(/focus/);

    await app.getByLabel("In Datei suchen").fill("nadelspitze");
    await app.getByTestId("file-viewer").getByRole("button", { name: "Suchen" }).click();
    await expect(app.getByTestId("file-find-note")).toContainText("Zeile 9002");
    await expect(app.locator('[data-line="9002"]')).toHaveClass(/focus/);
  });

  test("Syntaxfarben: kleine TS-Datei wird lazy gefärbt", async ({ app, hub }) => {
    writeFileSync(join(hub.alpha, "klein.ts"), 'export const x: number = 1;\n// Kommentar\n');
    await openFile(app, hub, "klein.ts");
    await expect(app.getByTestId("file-text").locator(".hljs-keyword").first()).toBeVisible();
    await expect(app.getByTestId("file-text").locator('[data-line="2"] .hljs-comment')).toBeVisible();
  });

  test("Markdown: eigener Renderer, <script> und javascript:-Links bleiben Text; Mermaid als passives Bild", async ({ app, hub }) => {
    writeFileSync(join(hub.alpha, "doc.md"), "# Titel\n\n<script>window.__pwned = 1</script>\n\n[böse](javascript:alert(1))\n\n```mermaid\ngraph TD; A-->B\n```\n\n- eins\n- zwei\n");
    await openFile(app, hub, "doc.md");
    await view(app, "Ansicht").click();
    const md = app.getByTestId("md-view");
    await expect(md.locator("h2")).toHaveText("Titel");
    await expect(md).toContainText("<script>window.__pwned = 1</script>");
    await expect(md.locator("a[href^='javascript']")).toHaveCount(0);
    await expect(md.getByTestId("mermaid-block").locator("img.mermaid-img")).toBeVisible({ timeout: 30_000 });
    expect(await app.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });

  test("JSON-Struktur, CSV-Tabelle und Notebook (ohne Ausführung)", async ({ app, hub }) => {
    writeFileSync(join(hub.alpha, "d.json"), JSON.stringify({ name: "x", liste: [1, 2, 3] }));
    writeFileSync(join(hub.alpha, "t.csv"), 'a,b\n1,"zwei, mit Komma"\n');
    writeFileSync(join(hub.alpha, "n.ipynb"), JSON.stringify({ cells: [
      { cell_type: "code", source: ["print(1)"], outputs: [{ output_type: "stream", text: ["EINS\n"] }, { output_type: "display_data", data: { "text/html": "<script>window.__nb = 1</script>" } }] },
      { cell_type: "markdown", source: "# Notiz" },
    ] }));
    await openFile(app, hub, "d.json");
    await view(app, "Ansicht").click();
    await expect(app.getByTestId("json-view")).toContainText("liste");
    await openFile(app, hub, "t.csv");
    await view(app, "Ansicht").click();
    await expect(app.getByTestId("csv-view").locator("td").nth(1)).toHaveText("zwei, mit Komma");
    await openFile(app, hub, "n.ipynb");
    await view(app, "Ansicht").click();
    const nb = app.getByTestId("notebook-view");
    await expect(nb).toContainText("EINS");
    await expect(nb).toContainText("wird nicht dargestellt");
    expect(await app.evaluate(() => (window as unknown as { __nb?: number }).__nb)).toBeUndefined();
  });

  test("YAML-Struktur (lazy js-yaml), Syntaxfehler benannt; Stand der Datei sichtbar", async ({ app, hub }) => {
    writeFileSync(join(hub.alpha, "c.yaml"), "name: x\nliste:\n  - 1\n  - 2\n");
    writeFileSync(join(hub.alpha, "kaputt.yml"), "a: [1, 2\nb: : :\n");
    await openFile(app, hub, "c.yaml");
    await expect(app.getByTestId("file-freshness")).toContainText("Revision");
    await view(app, "Ansicht").click();
    await expect(app.getByTestId("yaml-view")).toContainText("liste");
    await openFile(app, hub, "kaputt.yml");
    await view(app, "Ansicht").click();
    await expect(app.getByRole("status").filter({ hasText: "Kein gültiges YAML" })).toBeVisible();
  });

  test("SVG als passives Bild, HTML im Sandbox-iframe: Skripte laufen nicht", async ({ app, hub }) => {
    writeFileSync(join(hub.alpha, "s.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>window.__svg=1</script><rect width="10" height="10"/></svg>');
    writeFileSync(join(hub.alpha, "p.html"), "<h1>Seite</h1><script>window.parent.__html = 1; document.title='x'</script>");
    await openFile(app, hub, "s.svg");
    await view(app, "Ansicht").click();
    await expect(app.getByTestId("svg-view")).toBeVisible();
    await openFile(app, hub, "p.html");
    await view(app, "Ansicht").click();
    const frame = app.locator("iframe.file-html");
    await expect(frame).toHaveAttribute("sandbox", "");
    await expect(app.frameLocator("iframe.file-html").locator("h1")).toHaveText("Seite");
    expect(await app.evaluate(() => ({ s: (window as unknown as { __svg?: number }).__svg, h: (window as unknown as { __html?: number }).__html }))).toEqual({ s: undefined, h: undefined });
  });

  test("ZIP-Inhaltsverzeichnis und Office-Textauszug; Unbekanntes bleibt Hex", async ({ app, hub }) => {
    writeFileSync(join(hub.alpha, "a.zip"), zipSync({ "x.txt": strToU8("hallo"), "sub/y.txt": strToU8("welt") }));
    const slide = (t: string) => `<p:sld><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:sld>`;
    writeFileSync(join(hub.alpha, "f.pptx"), zipSync({ "ppt/slides/slide1.xml": strToU8(slide("FOLIENTEXT")) }));
    await openFile(app, hub, "a.zip");
    await expect(app.getByTestId("archive-view")).toContainText("sub/y.txt");
    await openFile(app, hub, "f.pptx");
    const office = app.getByTestId("office-view");
    await expect(office).toContainText("FOLIENTEXT");
    await expect(office).toContainText("keine Layout-Wiedergabe");
  });

  test("UTF-16LE mit BOM wird lesbar angezeigt", async ({ app, hub }) => {
    writeFileSync(join(hub.alpha, "w.txt"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("Zeile eins\nÜmläute 😀\n", "utf16le")]));
    await openFile(app, hub, "w.txt");
    await expect(app.getByTestId("file-text")).toContainText("Ümläute 😀");
  });
});
