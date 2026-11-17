#!/usr/bin/env node
/**
 * README-Bilder aus Repo-Dateien, ohne Netzwerk und ohne neue Aufnahmen:
 *
 * - social-preview-01.jpg (1280×640): Hero der README und GitHub-Social-
 *   Preview (Upload unter Settings → Social preview, dafür gibt es keine API).
 * - showcase-01.jpg (1600×960) und showcase-02.jpg (1000×1360, für schmale
 *   Bildschirme per <picture>): Desktop-Arbeitsfläche im Browserfenster,
 *   davor zwei Handys.
 *
 * Quellen sind PWA-Artwork, Logo und die Demo-Hub-Screenshots aus
 * `scripts/readme-screenshots.mjs` (docs/assets/readme-*.webp). Neue
 * Screenshots dort, dann `npm run readme:hero`. Schriften kommen aus
 * @fontsource, damit die Bilder auf jedem Rechner gleich aussehen.
 * Ausgabe nach apps/site/assets/ (check:media: JPEG ≤ 512 KiB, keine Metadaten).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const url = (p) => pathToFileURL(join(root, p)).href;
const OUT = join(root, "apps/site/assets");
const SHOT = {
  queue: url("docs/assets/readme-start-412.webp"),
  approval: url("docs/assets/readme-freigabe-412.webp"),
  desktop: url("docs/assets/readme-desktop-1280.webp"),
};
const AGENTS = ["Claude Code", "Codex", "pi", "opencode", "Copilot CLI", "Cursor", "Hermes", "+ any ACP agent"];

const font = (family, weight, file) =>
  `@font-face { font-family: ${family}; font-weight: ${weight}; src: url(${url(`node_modules/@fontsource/${file}`)}); }`;
const BASE_CSS = `
${font("Inter", 400, "inter/files/inter-latin-400-normal.woff2")}
${font("Inter", 600, "inter/files/inter-latin-600-normal.woff2")}
${font("Inter", 800, "inter/files/inter-latin-800-normal.woff2")}
${font("Orbitron", 800, "orbitron/files/orbitron-latin-800-normal.woff2")}
* { box-sizing: border-box; margin: 0; }
html, body { overflow: hidden; background: #05080a; }
.stage { position: relative; font-family: Inter, sans-serif; color: #e8eef2; }
.phone { position: absolute; border-radius: 38px; padding: 10px; background: #0d1216;
  border: 1px solid rgba(255,255,255,.14); box-shadow: 0 0 0 1px #000, 0 30px 80px rgba(0,0,0,.7), 0 0 90px rgba(52,211,153,.30); }
.phone img { width: 100%; height: 100%; object-fit: cover; object-position: top; border-radius: 29px; display: block; }`;

/** Handy-Rahmen: Innenbreite → Höhe im Seitenverhältnis der 412×915-Aufnahmen. */
const phone = (src, x, y, inner) =>
  `<div class="phone" style="left:${x}px;top:${y}px;width:${inner + 20}px;height:${Math.round((inner * 915) / 412) + 20}px"><img src="${src}" alt=""></div>`;

function heroHtml() {
  return `<style>${BASE_CSS}
html, body, .stage { width: 1280px; height: 640px; }
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
</style><div class="stage">
<div class="art"></div><div class="shade"></div>
<div class="copy">
  <div class="brand"><img src="${url("apps/pwa/public/assets/logo.webp")}" alt="">ANCIENTVOID</div>
  <h1>Every coding agent.<br>Every machine.<br><em>In your pocket.</em></h1>
  <p class="sub"><b>Self-hosted</b> · open source · no cloud · no telemetry</p>
  <div class="chips">${AGENTS.map((a) => `<span>${a}</span>`).join("")}</div>
</div>
${phone(SHOT.approval, 1280 - 92 - 276, 25, 256)}
</div>`;
}

/** Browserfenster mit Tailnet-Adresse: der Hub ist nur im eigenen Netz erreichbar. */
const browserWindow = (x, y, width) => {
  const screen = Math.round((width * 1600) / 2560);
  return `<div class="win" style="left:${x}px;top:${y}px;width:${width}px">
  <div class="bar"><i></i><i></i><i></i><span class="addr">🔒 hub.your-tailnet.ts.net</span></div>
  <img src="${SHOT.desktop}" alt="" style="height:${screen}px"></div>`;
};

function showcaseHtml(w, h, body) {
  return `<style>${BASE_CSS}
html, body, .stage { width: ${w}px; height: ${h}px; }
.stage { background:
  radial-gradient(ellipse 60% 55% at 50% 42%, rgba(52,211,153,.20), transparent 70%),
  radial-gradient(ellipse 45% 40% at 85% 90%, rgba(167,139,250,.16), transparent 70%),
  radial-gradient(ellipse 40% 40% at 10% 85%, rgba(52,211,153,.10), transparent 70%), #05080a; }
.win { position: absolute; border-radius: 14px; overflow: hidden; background: #0d1216;
  border: 1px solid rgba(255,255,255,.14); box-shadow: 0 40px 120px rgba(0,0,0,.75), 0 0 0 1px #000; }
.win img { display: block; width: 100%; object-fit: cover; object-position: top left; }
.bar { height: 36px; display: flex; align-items: center; gap: 8px; padding: 0 14px; background: #151b21; border-bottom: 1px solid rgba(255,255,255,.08); }
.bar i { width: 12px; height: 12px; border-radius: 50%; background: #3a434b; }
.bar i:first-child { background: #f87171; } .bar i:nth-child(2) { background: #fbbf24; } .bar i:nth-child(3) { background: #34d399; }
.addr { margin: 0 auto; transform: translateX(-30px); font-size: 14px; color: #93a4b0; background: #0b1014; padding: 5px 18px; border-radius: 999px; }
</style><div class="stage">${body}</div>`;
}

const IMAGES = [
  { file: "social-preview-01.jpg", w: 1280, h: 640, html: heroHtml() },
  {
    file: "showcase-01.jpg", w: 1600, h: 960,
    html: showcaseHtml(1600, 960, `${browserWindow(250, 50, 1120)}${phone(SHOT.queue, 40, 400, 236)}${phone(SHOT.approval, 1238, 262, 282)}`),
  },
  {
    file: "showcase-02.jpg", w: 1000, h: 1360,
    html: showcaseHtml(1000, 1360, `${browserWindow(40, 40, 920)}${phone(SHOT.queue, 60, 470, 380)}${phone(SHOT.approval, 520, 470, 380)}`),
  },
];

const dir = mkdtempSync(join(tmpdir(), "av-readme-art-"));
const browser = await chromium.launch();
try {
  for (const { file, w, h, html } of IMAGES) {
    const htmlFile = join(dir, `${file}.html`);
    writeFileSync(htmlFile, `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`);
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(htmlFile).href);
    // Ausdrücke als String: sie laufen im Browser, nicht in Node (eslint kennt dort kein `document`).
    await page.evaluate("document.fonts.ready");
    await page.waitForFunction("[...document.images].every((i) => i.complete && i.naturalWidth > 0)");
    await page.screenshot({ path: join(OUT, file), type: "jpeg", quality: 86 });
    await page.close();
    console.log(`readme-hero: ${join(OUT, file)}`);
  }
} finally {
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}
