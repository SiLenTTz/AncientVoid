#!/usr/bin/env node
/**
 * README-Hero und GitHub-Social-Preview (1280×640, JPEG ≤ 512 KiB): setzt
 * Markenmotiv (PWA-Artwork), Claim und den Handy-Screenshot aus
 * `scripts/readme-screenshots.mjs` zu einem Bild zusammen. Nur Repo-Dateien
 * als Quelle, keine Netzwerkzugriffe. Schriften kommen aus @fontsource,
 * damit das Bild auf jedem Rechner gleich aussieht.
 *
 * Ausgabe: apps/site/assets/social-preview-01.jpg, die Link-Vorschau des Repos
 * (Upload in GitHub unter Settings → Social preview, dafür gibt es keine API).
 * Oben in der README steht stattdessen die Demo-Animation aus
 * `scripts/readme-demo.mjs`.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const url = (p) => pathToFileURL(join(root, p)).href;
const OUT = join(root, "apps/site/assets/social-preview-01.jpg");

const AGENTS = ["Claude Code", "Codex", "pi", "opencode", "Copilot CLI", "Cursor", "Hermes", "+ any ACP agent"];

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Inter; font-weight: 400; src: url(${url("node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2")}); }
@font-face { font-family: Inter; font-weight: 600; src: url(${url("node_modules/@fontsource/inter/files/inter-latin-600-normal.woff2")}); }
@font-face { font-family: Inter; font-weight: 800; src: url(${url("node_modules/@fontsource/inter/files/inter-latin-800-normal.woff2")}); }
@font-face { font-family: Orbitron; font-weight: 800; src: url(${url("node_modules/@fontsource/orbitron/files/orbitron-latin-800-normal.woff2")}); }
* { box-sizing: border-box; margin: 0; }
html, body { width: 1280px; height: 640px; overflow: hidden; background: #05080a; }
.stage { position: relative; width: 1280px; height: 640px; font-family: Inter, sans-serif; color: #e8eef2; }
.art { position: absolute; inset: 0; background: url(${url("apps/pwa/public/assets/artwork-tempel.webp")}) 330px -40px / 1150px auto no-repeat; }
.shade { position: absolute; inset: 0; background:
  linear-gradient(90deg, rgba(5,8,10,.97) 0%, rgba(5,8,10,.92) 38%, rgba(5,8,10,.55) 52%, rgba(5,8,10,.12) 66%, rgba(5,8,10,.45) 100%),
  linear-gradient(0deg, rgba(5,8,10,.85) 0%, rgba(5,8,10,0) 30%); }
.copy { position: absolute; left: 64px; top: 58px; width: 700px; }
.brand { display: flex; align-items: center; gap: 14px; font-family: Orbitron, sans-serif; font-weight: 800; font-size: 26px; letter-spacing: .08em; }
.brand img { width: 52px; height: 52px; border-radius: 12px; }
h1 { margin-top: 34px; font-weight: 800; font-size: 62px; line-height: 1.06; letter-spacing: -.02em; }
h1 em { font-style: normal; color: #34d399; }
.sub { margin-top: 22px; font-size: 24px; color: #b6c4ce; }
.sub b { color: #e8eef2; font-weight: 600; }
.chips { margin-top: 30px; display: flex; flex-wrap: wrap; gap: 10px; width: 640px; }
.chips span { font-size: 18px; font-weight: 600; padding: 7px 14px; border-radius: 999px; background: rgba(52,211,153,.10); border: 1px solid rgba(52,211,153,.45); color: #c9f5e4; }
.phone { position: absolute; right: 92px; top: 25px; width: 276px; height: 590px; border-radius: 38px; padding: 10px; background: #0d1216;
  border: 1px solid rgba(255,255,255,.14); box-shadow: 0 0 0 1px #000, 0 30px 80px rgba(0,0,0,.7), 0 0 90px rgba(52,211,153,.35); }
.phone img { width: 100%; height: 100%; object-fit: cover; object-position: top; border-radius: 29px; display: block; }
</style></head><body><div class="stage">
<div class="art"></div><div class="shade"></div>
<div class="copy">
  <div class="brand"><img src="${url("apps/pwa/public/assets/logo.webp")}" alt="">ANCIENTVOID</div>
  <h1>Every coding agent.<br>Every machine.<br><em>In your pocket.</em></h1>
  <p class="sub"><b>Self-hosted</b> · open source · no cloud · no telemetry</p>
  <div class="chips">${AGENTS.map((a) => `<span>${a}</span>`).join("")}</div>
</div>
<div class="phone"><img src="${url("docs/assets/readme-freigabe-412.webp")}" alt=""></div>
</div></body></html>`;

const dir = mkdtempSync(join(tmpdir(), "av-hero-"));
const page_ = join(dir, "hero.html");
writeFileSync(page_, html);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(page_).href);
  // Ausdrücke als String: sie laufen im Browser, nicht in Node (eslint kennt dort kein `document`).
  await page.evaluate("document.fonts.ready");
  await page.waitForFunction("[...document.images].every((i) => i.complete && i.naturalWidth > 0)");
  await page.screenshot({ path: OUT, type: "jpeg", quality: 86 });
  console.log(`readme-hero: ${OUT}`);
} finally {
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}
