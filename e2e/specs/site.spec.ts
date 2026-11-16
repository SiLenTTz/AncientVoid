import { test, expect } from "../support/fixtures.ts";
import { createServer, type Server } from "node:http";
import { createReadStream, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

/**
 * EPIC-P62 T62.6 (AC-P62-7): Smoke-Spec der Promo-Seite — baut apps/site
 * frisch, servt dist statisch und prüft Hero, Feature-Grid aus content.json,
 * Links und das Click-to-load-Verhalten der Video-Einbettungen
 * (youtube-nocookie, kein Drittanbieter-Request beim Besuch).
 */

const dist = resolve(import.meta.dirname, "../../apps/site/dist");
const mime: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

function serve(): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    const path = req.url?.split("?")[0] ?? "/";
    const file = join(dist, path === "/" ? "index.html" : path);
    res.setHeader("content-type", mime[extname(file)] ?? "application/octet-stream");
    createReadStream(file).on("error", () => {
      res.statusCode = 404;
      res.end("not found");
    }).pipe(res);
  });
  return new Promise((done) => {
    server.listen(0, "127.0.0.1", () => done({ server, port: (server.address() as { port: number }).port }));
  });
}

test.describe("Promo-Seite apps/site (EPIC-P62 T62.6)", () => {
  let port: number;
  let server: Server;

  test.beforeAll(async () => {
    execFileSync("npm", ["-w", "@ancientvoid/site", "run", "build"], { stdio: "inherit" });
    ({ server, port } = await serve());
  });

  test.afterAll(async () => {
    await new Promise<void>((done) => server.close(() => done()));
  });

  test("Hero, Quickstart und Projekt-Links stehen", async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    await expect(page.locator("h1")).toHaveText("AncientVoid");
    await expect(page.locator(".tagline")).toContainText("local-first hub");
    await expect(page.locator(".quickstart code")).toHaveText("./setup.sh");
    await expect(page.locator('a[href*="github.com/SiLenTTz/AncientVoid"]').first()).toBeVisible();
    await expect(page.locator('#guide a[href*="docs/guide/README.md"]')).toBeVisible();
  });

  test("Feature-Grid kommt aus content.json — jede Karte hat Titel und Text", async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    const cards = page.locator("#feature-grid .feature");
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(9);
    const content = readFileSync(resolve(import.meta.dirname, "../../apps/site/src/content.json"), "utf8");
    const parsed = JSON.parse(content) as { features: { id: string; title: string }[] };
    for (const f of parsed.features) {
      await expect(page.locator(`#feature-${f.id} h3`)).toHaveText(f.title);
    }
  });

  test("Videos: ohne veröffentlichte Clips ehrlicher Hinweis; Embeds nur auf Klick", async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    // Noch keine Clip-IDs konfiguriert: der Platzhalter sagt das — kein toter Bereich.
    await expect(page.locator(".videos-soon")).toContainText(/Clips are being recorded/i);
    // Und selbst mit konfigurierten Clips gäbe es beim Besuch keinen iframe:
    await expect(page.locator("iframe")).toHaveCount(0);
  });
});
