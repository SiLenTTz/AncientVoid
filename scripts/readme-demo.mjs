#!/usr/bin/env node
/**
 * README-Demo als animiertes WebP: echte Aufnahme am Demo-Hub (TestHub-Muster,
 * Stand-in-CLIs, temporäres Datenverzeichnis, kein Cloud-Provider). Die
 * Geschichte in drei Schritten: der Agent bittet um eine Shell-Freigabe →
 * Tippen auf „Erlauben“ am Handy → der Agent läuft weiter, der Desktop
 * aktualisiert sich live.
 *
 * Leck-Sperre: Vor jeder Aufnahme wird der sichtbare Text beider Seiten gegen
 * Rechnername, Benutzername, Home- und Temp-Pfad geprüft. Ein Treffer bricht
 * ab, bevor ein Bild geschrieben wird (docs/demo-media.md).
 *
 * Voraussetzungen: ffmpeg mit libwebp im PATH und das Demo-Bündel
 *   npm -w @ancientvoid/pwa run build -- --outDir dist-e2e --emptyOutDir
 * Aufruf: `npm run readme:demo`. Ausgabe: apps/site/assets/demo-01.webp
 * (quer) und demo-02.webp (hoch, für schmale Bildschirme per <picture>),
 * je ≤ 512 KiB (check:media).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, hostname, tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const OUT = join(root, "apps/site/assets");
const WORK = join(tmpdir(), "ancientvoid-readme-demo");
const BUDGET = 512 * 1024;
const PHONE = { width: 412, height: 915 };
const DESK = { width: 1440, height: 900 };

const FORBIDDEN = [hostname(), userInfo().username, homedir(), tmpdir(), "AppData"].filter((s) => s && s.length >= 3);
async function guard(page, where) {
  const text = String(await page.evaluate("document.body.innerText")).toLowerCase();
  const hit = FORBIDDEN.find((s) => text.includes(s.toLowerCase()));
  if (hit && process.env.DEMO_DEBUG) {
    const i = text.indexOf(hit.toLowerCase());
    console.error(`[debug ${where}] …${text.slice(Math.max(0, i - 120), i + hit.length + 60).replaceAll("\n", " | ")}…`);
  }
  if (hit) throw new Error(`readme-demo: ${where} zeigt einen Rechner-/Nutzerbezug (${hit.length} Zeichen) — abgebrochen, kein Bild geschrieben`);
}

async function capture() {
  const { TestHub } = await import("../e2e/support/hub.ts");
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  const hub = await TestHub.start({ hostId: "demo-pc", label: "demo-pc" });
  const browser = await chromium.launch();
  const ctx = (viewport, mobile, scale) => browser.newContext({
    viewport, deviceScaleFactor: scale, isMobile: mobile, hasTouch: mobile,
    locale: "de-DE", timezoneId: "Europe/Berlin", reducedMotion: "reduce", serviceWorkers: "block",
  });
  const rename = async (id, title) => {
    const res = await hub.api(`/api/sessions/${id}/meta`, { method: "POST", body: { title } });
    if (res.status !== 200) throw new Error(`rename ${id} -> ${res.status}`);
  };
  const login = async (page) => {
    await page.goto(hub.origin);
    await page.getByLabel("Device-Token").fill(hub.token);
    await page.getByRole("button", { name: "Verbinden" }).click();
    await page.getByRole("heading", { name: "AncientVoid", exact: true }).waitFor();
    await page.locator(".session-title").filter({ hasText: "Tests ergänzen: Adapter-Matrix" }).first().waitFor();
  };
  // Ruhiges Bild: offene Toasts schließen, Mauszeiger aus dem Weg (sonst Hover-Tooltips).
  const shot = async (page, name) => {
    for (const close of await page.locator(".toast-close").all()) await close.click().catch(() => {});
    await page.mouse.move(2, 2);
    await page.waitForTimeout(400);
    await guard(page, name);
    await page.screenshot({ path: join(WORK, `${name}.png`) });
  };
  const center = async (locator) => { const b = await locator.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

  try {
    const running = await hub.createSession({ adapter: "claude", prompt: "Bitte LANGSAM: Migration der Datenbank vorbereiten" });
    const approval = await hub.createSession({ adapter: "claude", prompt: "Bitte WERKZEUG" });
    const question = await hub.createSession({ adapter: "claude", prompt: "Bitte FRAGE" });
    const done = await hub.createSession({ adapter: "dummy", prompt: "Wochenbericht zusammenfassen" });
    await rename(running, "Migration der Datenbank vorbereiten");
    await rename(approval, "Tests ergänzen: Adapter-Matrix");
    await rename(question, "Logo-Entwurf finalisieren");
    await rename(done, "Wochenbericht zusammenfassen");

    const desk = await (await ctx(DESK, false, 1)).newPage();
    await login(desk);
    const card = (text) => desk.locator(".split-list .session-card").filter({ hasText: text }).locator(".session-open");
    await card("Tests ergänzen: Adapter-Matrix").click();
    await card("Migration der Datenbank vorbereiten").click({ modifiers: ["Control"] });
    await desk.locator('.tile[data-tile="2"]').waitFor();
    // Erst aufnehmen, wenn Freigabe und Rückfrage in „Du bist dran“ angekommen sind.
    await desk.getByText("Freigabe nötig").first().waitFor();
    await desk.getByText("Rückfrage").first().waitFor();
    await desk.waitForTimeout(800);
    await shot(desk, "desk-a");

    const phone = await (await ctx(PHONE, true, 2)).newPage();
    await login(phone);
    const target = phone.locator(".session-title").filter({ hasText: "Tests ergänzen: Adapter-Matrix" }).first();
    const tapCard = await center(target);
    await shot(phone, "phone-a");
    await target.click();
    const allow = phone.getByRole("button", { name: "Erlauben" });
    if (!(await allow.isVisible().catch(() => false))) await phone.getByRole("button", { name: "Chat" }).click().catch(() => {});
    await allow.waitFor();
    await phone.waitForTimeout(500);
    const tapAllow = await center(allow);
    await shot(phone, "phone-b");
    await allow.click();
    await allow.waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
    await phone.waitForTimeout(3000);
    await shot(phone, "phone-c");
    await shot(desk, "desk-c");
    await browser.close();
    return { tapCard, tapAllow };
  } finally {
    await browser.close().catch(() => {});
    await hub.stop();
  }
}

const STEPS = [
  "Your agent wants to run a shell command",
  "Approve it from your phone",
  "It keeps working, and every screen updates live",
];

/** Zeitleiste: eindeutige Frames mit Dauer (ms). Überblendungen und Tipp-Kreise sind eigene Frames. */
function timeline({ tapCard, tapAllow }) {
  const f = [];
  const hold = (desk, phone, step, ms) => f.push({ desk: [desk, desk, 0], phone: [phone, phone, 0], step, ms });
  const ripple = (desk, phone, step, at) => [[18, 0.9], [26, 0.7], [34, 0.45], [42, 0.2]].forEach(([r, o]) =>
    f.push({ desk: [desk, desk, 0], phone: [phone, phone, 0], step, ripple: { ...at, r, o }, ms: 80 }));
  const fade = (desk, phone, step, n) => { for (let i = 1; i <= n; i++) f.push({ desk: [desk[0], desk[1], i / n], phone: [phone[0], phone[1], i / n], step, ms: 70 }); };
  hold("desk-a", "phone-a", 0, 1600);
  ripple("desk-a", "phone-a", 0, tapCard);
  fade(["desk-a", "desk-a"], ["phone-a", "phone-b"], 1, 4);
  hold("desk-a", "phone-b", 1, 1600);
  ripple("desk-a", "phone-b", 1, tapAllow);
  fade(["desk-a", "desk-c"], ["phone-b", "phone-c"], 2, 5);
  hold("desk-c", "phone-c", 2, 2800);
  fade(["desk-c", "desk-a"], ["phone-c", "phone-a"], 0, 5);
  return f;
}

const LAYOUTS = {
  "demo-01": { w: 1280, h: 720, cap: { x: 40, y: 26, w: 1200, size: 24 }, win: { x: 40, y: 92, w: 860 }, phone: { x: 952, y: 84, inner: 268 } },
  "demo-02": { w: 720, h: 1100, cap: { x: 30, y: 24, w: 660, size: 22 }, win: { x: 30, y: 110, w: 660 }, phone: { x: 200, y: 400, inner: 300 } },
};

function page(layout) {
  const img = (name) => pathToFileURL(join(WORK, `${name}.png`)).href;
  const font = (w) => `@font-face { font-family: Inter; font-weight: ${w}; src: url(${pathToFileURL(join(root, `node_modules/@fontsource/inter/files/inter-latin-${w}-normal.woff2`)).href}); }`;
  const { w, h, cap, win, phone } = layout;
  const screenH = Math.round((win.w * DESK.height) / DESK.width);
  const phoneH = Math.round((phone.inner * PHONE.height) / PHONE.width);
  const names = ["desk-a", "desk-c", "phone-a", "phone-b", "phone-c"];
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${font(400)} ${font(600)} ${font(800)}
* { box-sizing: border-box; margin: 0; }
html, body { width: ${w}px; height: ${h}px; overflow: hidden; background: #05080a; font-family: Inter, sans-serif; }
.stage { position: relative; width: ${w}px; height: ${h}px; background:
  radial-gradient(ellipse 60% 55% at 45% 50%, rgba(52,211,153,.16), transparent 70%),
  radial-gradient(ellipse 40% 45% at 85% 60%, rgba(167,139,250,.16), transparent 70%), #05080a; }
.cap { position: absolute; left: ${cap.x}px; top: ${cap.y}px; width: ${cap.w}px; display: flex; align-items: center; gap: 14px; color: #e8eef2; font-size: ${cap.size}px; font-weight: 600; }
.dots { display: flex; gap: 6px; flex: none; }
.dots b { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; font-size: 15px; font-weight: 800; background: #151b21; color: #5b6770; border: 1px solid rgba(255,255,255,.1); }
.dots b.on { background: #34d399; color: #04241a; border-color: #34d399; }
.win { position: absolute; left: ${win.x}px; top: ${win.y}px; width: ${win.w}px; border-radius: 12px; overflow: hidden; background: #0d1216;
  border: 1px solid rgba(255,255,255,.14); box-shadow: 0 30px 90px rgba(0,0,0,.7); }
.bar { height: 32px; display: flex; align-items: center; gap: 7px; padding: 0 12px; background: #151b21; border-bottom: 1px solid rgba(255,255,255,.08); }
.bar i { width: 11px; height: 11px; border-radius: 50%; } .bar i:nth-child(1) { background: #f87171; } .bar i:nth-child(2) { background: #fbbf24; } .bar i:nth-child(3) { background: #34d399; }
.addr { margin: 0 auto; transform: translateX(-28px); font-size: 13px; color: #93a4b0; background: #0b1014; padding: 4px 16px; border-radius: 999px; }
.screen, .pscreen { position: relative; overflow: hidden; }
.screen { height: ${screenH}px; } .pscreen { height: ${phoneH}px; border-radius: 28px; }
.screen img, .pscreen img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: top left; opacity: 0; }
.phone { position: absolute; left: ${phone.x}px; top: ${phone.y}px; width: ${phone.inner + 20}px; padding: 10px; border-radius: 38px; background: #0d1216;
  border: 1px solid rgba(255,255,255,.14); box-shadow: 0 0 0 1px #000, 0 30px 80px rgba(0,0,0,.7), 0 0 80px rgba(52,211,153,.28); }
.ripple { position: absolute; border-radius: 50%; background: rgba(255,255,255,.55); border: 2px solid #fff; transform: translate(-50%, -50%); pointer-events: none; }
</style></head><body><div class="stage">
<div class="cap"><span class="dots"><b>1</b><b>2</b><b>3</b></span><span id="text"></span></div>
<div class="win"><div class="bar"><i></i><i></i><i></i><span class="addr">🔒 hub.your-tailnet.ts.net</span></div>
  <div class="screen">${names.filter((n) => n.startsWith("desk")).map((n) => `<img id="${n}" src="${img(n)}">`).join("")}</div></div>
<div class="phone"><div class="pscreen">${names.filter((n) => n.startsWith("phone")).map((n) => `<img id="${n}" src="${img(n)}">`).join("")}<div class="ripple" id="ripple"></div></div></div>
</div><script>
const STEPS = ${JSON.stringify(STEPS)};
const SCALE = ${phone.inner / PHONE.width};
window.renderFrame = (f) => {
  document.querySelectorAll("img").forEach((i) => (i.style.opacity = 0));
  for (const [from, to, t] of [f.desk, f.phone]) {
    document.getElementById(from).style.opacity = 1;
    if (to !== from) document.getElementById(to).style.opacity = t;
  }
  document.getElementById("text").textContent = STEPS[f.step];
  document.querySelectorAll(".dots b").forEach((b, i) => b.classList.toggle("on", i === f.step));
  const r = document.getElementById("ripple");
  r.style.display = f.ripple ? "block" : "none";
  if (f.ripple) Object.assign(r.style, { left: f.ripple.x * SCALE + "px", top: f.ripple.y * SCALE + "px", width: 2 * f.ripple.r + "px", height: 2 * f.ripple.r + "px", opacity: f.ripple.o });
};
</script></body></html>`;
}

async function render(frames) {
  const browser = await chromium.launch();
  try {
    for (const [name, layout] of Object.entries(LAYOUTS)) {
      const dir = join(WORK, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "page.html"), page(layout));
      const p = await browser.newPage({ viewport: { width: layout.w, height: layout.h }, deviceScaleFactor: 1 });
      await p.goto(pathToFileURL(join(dir, "page.html")).href);
      await p.evaluate("document.fonts.ready");
      await p.waitForFunction("[...document.images].every((i) => i.complete && i.naturalWidth > 0)");
      const list = ["ffconcat version 1.0"];
      for (const [i, f] of frames.entries()) {
        await p.evaluate(`window.renderFrame(${JSON.stringify(f)})`);
        const file = `f${String(i).padStart(3, "0")}.png`;
        await p.screenshot({ path: join(dir, file) });
        list.push(`file '${file}'`, `duration ${(f.ms / 1000).toFixed(3)}`);
      }
      list.push(`file 'f${String(frames.length - 1).padStart(3, "0")}.png'`); // concat: letzte Dauer gilt nur mit Folgezeile
      writeFileSync(join(dir, "list.txt"), list.join("\n"));
      await p.close();
      encode(name, dir);
    }
  } finally {
    await browser.close();
  }
}

/** Qualität absteigend, bis das Budget passt — laut scheitern, wenn nicht. */
function encode(name, dir) {
  const out = join(OUT, `${name}.webp`);
  for (const q of [78, 70, 62, 54, 46]) {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(dir, "list.txt"),
      "-fps_mode", "vfr", "-map_metadata", "-1", "-c:v", "libwebp_anim", "-lossless", "0", "-q:v", String(q),
      "-compression_level", "6", "-loop", "0", out]);
    const size = statSync(out).size;
    if (size <= BUDGET) { console.log(`readme-demo: ${out} (${Math.round(size / 1024)} KiB, q=${q})`); return; }
  }
  rmSync(out, { force: true });
  throw new Error(`readme-demo: ${name} passt bei keiner Qualität in ${BUDGET / 1024} KiB`);
}

const taps = await capture();
await render(timeline(taps));
rmSync(WORK, { recursive: true, force: true });
