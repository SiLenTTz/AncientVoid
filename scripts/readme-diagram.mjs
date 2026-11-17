#!/usr/bin/env node
/**
 * README-Architekturbild „How it works“ statt Mermaid: Mermaid sieht in
 * VS Code, GitHub hell und GitHub dunkel jeweils anders aus. Dieses Bild
 * bringt seinen eigenen dunklen Hintergrund mit und zeigt das
 * Lokal-Versprechen als Grenze: Geräte, Hub und Agenten liegen im eigenen
 * Netz, nur die API-Aufrufe der Agenten verlassen es.
 *
 * Aufruf: `npm run readme:diagram`. Ausgabe: apps/site/assets/architecture-01.webp
 * (quer) und architecture-02.webp (hoch, für schmale Bildschirme per
 * <picture>), doppelte Auflösung, je ≤ 512 KiB (check:media). Nur
 * Repo-Dateien, kein Netzwerk; Schriften aus @fontsource.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const url = (p) => pathToFileURL(join(root, p)).href;
const OUT = join(root, "apps/site/assets");
const BUDGET = 512 * 1024;

/** Linien-Icons (24er-Raster, Strich), damit nichts von Emoji-Schriften abhängt. */
const ICON = {
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M11 18.5h2"/>',
  tablet: '<rect x="3.5" y="3" width="17" height="18" rx="2.2"/><path d="M11 18h2"/>',
  desktop: '<rect x="2.5" y="4" width="19" height="12.5" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  db: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13"/><path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/>',
  shield: '<path d="M12 3l7.5 2.8v5.7c0 4.7-3.2 7.9-7.5 9.5-4.3-1.6-7.5-4.8-7.5-9.5V5.8z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  branch: '<circle cx="6.5" cy="5.5" r="2.2"/><circle cx="6.5" cy="18.5" r="2.2"/><circle cx="17.5" cy="7.5" r="2.2"/><path d="M6.5 7.7v8.6M17.5 9.7c0 4.3-6 4-10 6.6"/>',
  bell: '<path d="M6 16.5v-5.2a6 6 0 0 1 12 0v5.2l1.8 1.8H4.2z"/><path d="M10 20.8a2 2 0 0 0 4 0"/>',
  server: '<rect x="3.5" y="4" width="17" height="7" rx="1.8"/><rect x="3.5" y="13" width="17" height="7" rx="1.8"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  term: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M7 9.5l3 2.5-3 2.5M12.5 15h4.5"/>',
  cloud: '<path d="M7 18.5h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.6 1.6A3.3 3.3 0 0 0 7 18.5z"/>',
};
const icon = (name) => `<svg class="ico" viewBox="0 0 24 24">${ICON[name]}</svg>`;

const DEVICES = [
  ["phone", "Phone", "Queue, approvals, voice"],
  ["tablet", "Tablet & foldable", "Split view"],
  ["desktop", "Desktop browser", "Up to four session tiles"],
];
const HUB_ROWS = [
  ["db", "Event log", "JSONL + SQLite · survives kill -9"],
  ["shield", "Approvals", "passkey for destructive · audited"],
  ["branch", "Git worktrees", "one per session · diff review"],
  ["bell", "Push & offline", "web push · last state cached"],
];
const AGENTS = ["Claude Code", "Codex", "pi", "opencode", "Copilot CLI", "Cursor", "Hermes", "aider", "Any ACP agent", "Local models"];
const PROPS = ["No AncientVoid cloud or account", "No telemetry", "Open source · AGPL-3.0"];

const at = (x, y, w, h) => `left:${x}px;top:${y}px;width:${w}px${h ? `;height:${h}px` : ""}`;
const device = ([ic, title, sub], x, y, w, h, vertical) =>
  `<div class="card dev${vertical ? " vert" : ""}" style="${at(x, y, w, h)}"><span class="ib violet">${icon(ic)}</span><span><b class="h">${title}</b><span class="s">${sub}</span></span></div>`;
const hub = (x, y, w, h) => `<div class="card hub" style="${at(x, y, w, h)}">
  <div class="hubhead"><img src="${url("apps/pwa/public/assets/logo.webp")}" alt=""><span><b class="h big">AncientVoid hub</b><span class="s">one per machine · runs your agent CLIs</span></span></div>
  ${HUB_ROWS.map(([ic, t, s]) => `<div class="row"><span class="ib green">${icon(ic)}</span><span><b class="h">${t}</b><span class="s">${s}</span></span></div>`).join("")}</div>`;
const chip = (name, x, y, w) => `<div class="chip" style="${at(x, y, w)}">${icon("term")}${name}</div>`;
const pill = (x, y, html, cls = "") => `<div class="pill ${cls}" style="left:${x}px;top:${y}px">${html}</div>`;
const head = (x, y, title, sub, align = "left") => `<div class="head" style="left:${x}px;top:${y}px;text-align:${align}"><b>${title}</b><span>${sub}</span></div>`;
const wire = (d, dashed = false, both = false) =>
  `<path d="${d}" class="${dashed ? "dash" : ""}" marker-end="url(#a)"${both ? ' marker-start="url(#a)"' : ""}/>`;

function css(w, h, k) {
  const font = (wt) => `@font-face { font-family: Inter; font-weight: ${wt}; src: url(${url(`node_modules/@fontsource/inter/files/inter-latin-${wt}-normal.woff2`)}); }`;
  return `${font(400)} ${font(600)} ${font(800)}
* { box-sizing: border-box; margin: 0; }
html, body { width: ${w}px; height: ${h}px; overflow: hidden; background: #070b0e; font-family: Inter, sans-serif; color: #e8eef2; }
.stage { position: relative; width: ${w}px; height: ${h}px; background:
  radial-gradient(ellipse 45% 40% at 50% 42%, rgba(52,211,153,.11), transparent 70%),
  radial-gradient(ellipse 30% 30% at 12% 35%, rgba(167,139,250,.10), transparent 70%), #070b0e; }
.dots { position: absolute; inset: 0; background-image: radial-gradient(rgba(255,255,255,.05) 1px, transparent 1.2px); background-size: 26px 26px; }
.boundary { position: absolute; border: 2px dashed rgba(52,211,153,.5); border-radius: 30px; background: rgba(52,211,153,.025); }
.blabel { position: absolute; padding: 0 14px; background: #070b0e; color: #34d399; font-weight: 800; font-size: ${15 * k}px; letter-spacing: .16em; }
.head { position: absolute; display: flex; flex-direction: column; gap: 4px; }
.head b { font-size: ${22 * k}px; font-weight: 800; } .head span { font-size: ${15 * k}px; color: #93a4b0; }
.card { position: absolute; background: #0e1419; border: 1px solid rgba(255,255,255,.10); border-radius: 18px; box-shadow: 0 18px 44px rgba(0,0,0,.45); }
.h { display: block; font-weight: 800; font-size: ${18 * k}px; } .h.big { font-size: ${25 * k}px; }
.s { display: block; margin-top: 3px; color: #93a4b0; font-size: ${14 * k}px; line-height: 1.35; }
.ico { width: ${24 * k}px; height: ${24 * k}px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; flex: none; }
.ib { width: ${46 * k}px; height: ${46 * k}px; border-radius: 12px; display: grid; place-items: center; flex: none; }
.ib.violet { background: rgba(167,139,250,.13); color: #c4b5fd; } .ib.green { background: rgba(52,211,153,.12); color: #6ee7b7; }
.dev { display: flex; align-items: center; gap: 16px; padding: 0 18px; }
.dev.vert { flex-direction: column; justify-content: center; text-align: center; gap: 12px; padding: 0 12px; }
.hub { padding: ${22 * k}px ${24 * k}px ${10 * k}px; border-color: rgba(52,211,153,.6); background: linear-gradient(180deg, #0f1c18, #0b1114);
  box-shadow: 0 0 0 1px rgba(52,211,153,.12), 0 0 90px rgba(52,211,153,.22), 0 30px 70px rgba(0,0,0,.6); }
.hubhead { display: flex; align-items: center; gap: 16px; padding-bottom: ${16 * k}px; }
.hubhead img { width: ${52 * k}px; height: ${52 * k}px; border-radius: 12px; }
.row { display: flex; align-items: center; gap: 16px; padding: ${13 * k}px 0; border-top: 1px solid rgba(255,255,255,.08); }
.chip { position: absolute; height: ${42 * k}px; display: flex; align-items: center; gap: 10px; padding: 0 14px; border-radius: 12px;
  background: #0e1419; border: 1px solid rgba(255,255,255,.10); font-weight: 600; font-size: ${16 * k}px; }
.chip .ico { width: ${19 * k}px; height: ${19 * k}px; color: #6ee7b7; }
.ext { background: #0c1013; border-style: dashed; border-color: rgba(255,255,255,.18); box-shadow: none; display: flex; align-items: center; gap: 16px; padding: 0 20px; }
.ext .ib { background: rgba(255,255,255,.06); color: #93a4b0; }
.pill { position: absolute; transform: translate(-50%, -50%); display: flex; align-items: center; gap: 7px; white-space: nowrap; padding: ${7 * k}px ${13 * k}px;
  border-radius: 999px; background: #0b1114; border: 1px solid rgba(52,211,153,.5); color: #d1fae5; font-weight: 700; font-size: ${14 * k}px; }
.pill small { display: block; font-weight: 400; color: #93a4b0; font-size: ${12 * k}px; }
.pill .ico { width: ${18 * k}px; height: ${18 * k}px; color: #34d399; }
.pill.grey { border-color: rgba(255,255,255,.2); color: #cbd5dc; }
.props { position: absolute; display: flex; gap: 12px; justify-content: center; transform: translateX(-50%); }
.props span { white-space: nowrap; padding: ${7 * k}px ${15 * k}px; border-radius: 999px; font-size: ${14 * k}px; font-weight: 600; color: #c9f5e4;
  background: rgba(52,211,153,.08); border: 1px solid rgba(52,211,153,.35); }
svg.wires { position: absolute; inset: 0; overflow: visible; }
svg.wires path { fill: none; stroke: #34d399; stroke-width: 2.4; } svg.wires path.dash { stroke-dasharray: 7 7; stroke: #5b6b75; }`;
}

const svg = (w, h, paths) => `<svg class="wires" width="${w}" height="${h}"><defs>
  <marker id="a" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#34d399" stroke="none"/></marker></defs>${paths.join("")}</svg>`;
const props = (cx, y) => `<div class="props" style="left:${cx}px;top:${y}px">${PROPS.map((p) => `<span>${p}</span>`).join("")}</div>`;
const model = (x, y, w, h) => `<div class="card ext" style="${at(x, y, w, h)}"><span class="ib">${icon("cloud")}</span><span><b class="h">Model providers</b><span class="s">Anthropic, OpenAI, …<br>called by your agents,<br>exactly as before</span></span></div>`;
const fleet = (x, y, w, h) => `<div class="card dev" style="${at(x, y, w, h)}"><span class="ib green">${icon("server")}</span><span><b class="h">Hub on another machine</b><span class="s">joins as a fleet, one UI</span></span></div>`;
const tunnel = `${icon("lock")}<span>your tailnet only<small>WireGuard · no public port</small></span>`;

function landscape() {
  const W = 1680, H = 900, k = 1;
  const y0 = 358; // Höhe der waagerechten Verbindungen
  return { W, H, k, body: `<div class="dots"></div>
<div class="boundary" style="${at(32, 40, 1276, 820)}"></div><div class="blabel" style="left:64px;top:30px">YOUR MACHINES · YOUR NETWORK</div>
${head(70, 96, "Your screens", "Installable PWA · no app store")}
${DEVICES.map((d, i) => device(d, 70, 200 + i * 112, 290, 92)).join("")}
${hub(560, 150, 400, 400)}
${fleet(590, 690, 340, 84)}
${head(1060, 96, "Your agent CLIs", "Your logins and subscriptions")}
${AGENTS.map((a, i) => chip(a, 1060, 170 + i * 50, 220)).join("")}
${model(1372, 270, 268, 176)}
${svg(W, H, [wire(`M362 ${y0}H556`, false, true), wire(`M962 ${y0}H1056`), wire("M760 554V686", true, true), wire(`M1282 ${y0}H1368`, true)])}
${pill(460, y0, tunnel)}${pill(1009, y0 - 30, "adapters")}${pill(760, 620, "fleet", "grey")}${pill(1325, y0 - 30, "API calls", "grey")}
${props(670, 806)}` };
}

/** Hochformat: Hub unten bei 1020, darunter links die Flotte, rechts die Adapter-Linie zu den Agenten. */
function portrait() {
  const W = 900, H = 1980, k = 1.3;
  return { W, H, k, body: `<div class="dots"></div>
<div class="boundary" style="${at(26, 46, 848, 1614)}"></div><div class="blabel" style="left:56px;top:33px">YOUR MACHINES · YOUR NETWORK</div>
${head(60, 96, "Your screens", "Installable PWA · no app store")}
${DEVICES.map((d, i) => device(d, 56 + i * 268, 186, 252, 196, true)).join("")}
${hub(150, 500, 600, 520)}
${fleet(56, 1100, 420, 100)}
${head(60, 1228, "Your agent CLIs", "Your logins and subscriptions")}
${AGENTS.map((a, i) => chip(a, 56 + (i % 2) * 400, 1310 + Math.floor(i / 2) * 64, 388)).join("")}
${model(170, 1720, 560, 150)}
${svg(W, H, [wire("M450 386V496", false, true), wire("M650 1024V1306"), wire("M266 1024V1096", true, true), wire("M450 1626V1716", true)])}
${pill(450, 440, tunnel)}${pill(650, 1150, "adapters")}${pill(266, 1060, "fleet", "grey")}${pill(450, 1660, "API calls", "grey")}
${props(450, 1906)}` };
}

/** WebP mit ffmpeg (libwebp): erst verlustfrei, sonst absteigende Qualität bis ins Budget — laut scheitern, wenn nichts passt. */
function encode(png, out) {
  const tries = [["-lossless", "1"], ...[92, 86, 80].map((q) => ["-lossless", "0", "-quality", String(q)])];
  for (const opts of tries) {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", png, "-map_metadata", "-1", "-c:v", "libwebp", ...opts, "-compression_level", "6", out]);
    const size = statSync(out).size;
    if (size <= BUDGET) { console.log(`readme-diagram: ${out} (${Math.round(size / 1024)} KiB, ${opts.join(" ")})`); return; }
  }
  rmSync(out, { force: true });
  throw new Error(`readme-diagram: ${out} passt bei keiner Qualität in ${BUDGET / 1024} KiB`);
}

const dir = mkdtempSync(join(tmpdir(), "av-diagram-"));
const browser = await chromium.launch();
try {
  for (const [name, build] of [["architecture-01", landscape], ["architecture-02", portrait]]) {
    const { W, H, k, body } = build();
    const htmlFile = join(dir, `${name}.html`);
    writeFileSync(htmlFile, `<!doctype html><html><head><meta charset="utf-8"><style>${css(W, H, k)}</style></head><body><div class="stage">${body}</div></body></html>`);
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
    await page.goto(pathToFileURL(htmlFile).href);
    // Ausdrücke als String: sie laufen im Browser, nicht in Node (eslint kennt dort kein `document`).
    await page.evaluate("document.fonts.ready");
    await page.waitForFunction("[...document.images].every((i) => i.complete && i.naturalWidth > 0)");
    // Feste Geometrie: läuft Text aus einer Karte, ist das Layout kaputt — laut scheitern statt still verschieben.
    const overflow = await page.evaluate("[...document.querySelectorAll('.card, .chip')].filter((e) => e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim().slice(0, 40))");
    if (overflow.length) throw new Error(`readme-diagram: ${name}: Inhalt passt nicht in ${overflow.join(" | ")}`);
    const png = join(dir, `${name}.png`);
    await page.screenshot({ path: png });
    await page.close();
    encode(png, join(OUT, `${name}.webp`));
  }
} finally {
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}
