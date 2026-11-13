#!/usr/bin/env node
/**
 * Messlauf TTFS (EPIC-P57 T57.10, AC-P57-1): Time to First Success — vom
 * frischen Klon bis zur ersten vom „Handy“ gesendeten Nachricht in einer
 * laufenden dummy-Session (M5), auf demselben Pfad, den das Tutorial
 * beschreibt: Wizard (`--yes --adapter=dummy`) → Token-Gate → Übersicht →
 * Probe-Session (T57.9) → Nachricht im Verlauf.
 *
 * Ehrlichkeitsgrenze: M2/M3 der echten Strecke (Tailscale-Konto, zweites
 * Gerät) sind nicht automatisierbar. Der Lauf ersetzt das Handy durch
 * Playwright im Pixel-7-Viewport (412 px); die Tailscale-Netzstrecke fehlt
 * und wird im Bericht als manuelle Messung ausgewiesen (Epic §3.5).
 *
 *   node scripts/messlauf-ttfs.mjs [--runs 3] [--m5b] [--keep]
 *
 * `--m5b` misst zusätzlich die Freigabe-Variante mit dem Stand-in-Harness
 * `claude` aus e2e/support/bin (keine Cloud): Adapter nachträglich in die
 * Config des Klons, Hub mit Stub-PATH neu gestartet. Die Freigabe-Latenz
 * selbst gehört zu messlauf-approve-latency.mjs (K1) — hier wird nur der
 * Erststart-Pfad einmal durchlaufen.
 *
 * Nach Skill messlauf: Dieses Skript misst und druckt; der Beleg-Lauf wird
 * mit Umgebung/Commit/Kommando unter docs/messlauf/ abgelegt. Das Device-
 * Token aus dem Wizard-Output wird geparst, aber nie ausgegeben (PRD §8).
 */
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright";

const args = process.argv.slice(2);
const num = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const RUNS = Math.max(1, num("runs", 1));
const M5B = args.includes("--m5b");
const KEEP = args.includes("--keep");

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const CHROMIUM_PATH = "/usr/bin/chromium"; // wie messlauf-approve-latency.mjs: System-Chromium
const COMMIT = execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"]).toString().trim();

/** Shell-Kommando mit Timeout; löst mit { stdout } auf, wirft bei Exit ≠ 0. */
function sh(cmd, argv, { cwd, env, timeoutMs = 20 * 60_000 } = {}) {
  return new Promise((resolveSh, rejectSh) => {
    const p = spawn(cmd, argv, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("error", (err) => {
      clearTimeout(timer);
      rejectSh(err);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolveSh({ stdout: out }) : rejectSh(new Error(`${cmd} exit ${code}`));
    });
  });
}

function freePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

async function untilReady(origin, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${origin}/api/ready`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch {
      // Hub noch nicht oben — weiter pollen.
    }
    if (Date.now() > deadline) throw new Error(`/api/ready nicht grün nach ${Math.round(timeoutMs / 1000)} s`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** Device-Token aus dem Wizard-Output schneiden — ohne es je zu drucken. */
function parseToken(output) {
  const lines = output.split("\n");
  const i = lines.findIndex((l) => l.includes("Device-Token für die PWA (einmalig sichtbar!):"));
  if (i < 0) throw new Error("Wizard-Output enthält kein Device-Token (Marker fehlt)");
  for (let j = i + 1; j < lines.length; j++) {
    const t = lines[j].trim();
    if (t) return t;
  }
  throw new Error("Wizard-Output: Token-Zeile leer");
}

/** Fehlerausgabe, in der das Token nicht vorkommen darf (PRD §8). */
const redact = (text, token) => token ? text.split(token).join("***TOKEN***") : text;

const s = (ms) => `${(ms / 1000).toFixed(1)} s`;
const mins = (ms) => `${(ms / 60_000).toFixed(1)} min`;

async function oneRun(index, browser) {
  const dir = await mkdtemp(join(tmpdir(), "av-ttfs-"));
  const clone = join(dir, "clone");
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const marks = {};
  let token = "";
  // HUB_LOCAL=1 ist Pflicht: Ohne es leitet hub.sh stop/start an die systemd-Unit
  // ancientvoid-hub.service weiter und nimmt auf Entwickler-Maschinen den
  // Produktiv-Hub herunter (Vorfall 15:17–15:31, 13.11.2026).
  const hubEnv = { ...process.env, HUB_LOCAL: "1" };
  const stopHub = () => sh("bash", ["scripts/hub.sh", "stop"], { cwd: clone, env: hubEnv, timeoutMs: 60_000 }).catch(() => undefined);
  let activePage = null;
  let failed = false;

  try {
    // M0: frischer Klon des aktuellen Commits (lokal, ohne Netz — im Bericht ausgewiesen).
    const t0 = Date.now();
    await sh("git", ["clone", "--quiet", repoRoot, clone], { timeoutMs: 5 * 60_000 });
    await sh("git", ["-C", clone, "checkout", "--quiet", COMMIT], { timeoutMs: 60_000 });
    marks.M0 = Date.now() - t0;

    // M1: Wizard ohne Rückfragen, dummy, freier Port; Token nie loggen.
    process.stdout.write(`  … Klon fertig, Wizard läuft\n`);
    const setup = await sh("bash", ["./setup.sh", "--yes", "--adapter=dummy", `--port=${port}`], { cwd: clone, timeoutMs: 20 * 60_000 });
    token = parseToken(setup.stdout);
    await untilReady(origin, 120_000);
    marks.M1 = Date.now() - t0;

    // Tutorial §3 (BUG-0153): Wizard lässt projectRoots leer — der dokumentierte
    // Schritt ist Config-Eintrag + Hub-Neustart. Der Ordner über dem Klon enthält
    // ein Repo (den Klon selbst), Tiefe 1 wie in der Anleitung.
    await sh(
      "node",
      ["-e", 'const fs=require("node:fs");const f="hub.config.json";const c=JSON.parse(fs.readFileSync(f,"utf8"));c.projectRoots=[process.argv[1]];fs.writeFileSync(f,JSON.stringify(c,null,2)+"\\n");', dir],
      { cwd: clone, timeoutMs: 30_000 },
    );
    await sh("bash", ["scripts/hub.sh", "stop"], { cwd: clone, env: hubEnv, timeoutMs: 60_000 });
    await sh("bash", ["scripts/hub.sh", "start"], { cwd: clone, env: hubEnv, timeoutMs: 120_000 });
    await untilReady(origin, 120_000);

    // Handy-Ersatz: Pixel-7-Viewport, wie das mobile E2E-Projekt.
    const ctx = await browser.newContext({ ...devices["Pixel 7"] });
    ctx.setDefaultTimeout(90_000);
    const page = await ctx.newPage();
    activePage = page;

    // M2: PWA erreicht den (simulierten) Handy-Browser — Gate sichtbar.
    await page.goto(origin);
    await page.getByRole("heading", { name: "Anmeldung bei AncientVoid" }).waitFor();
    marks.M2 = Date.now() - t0;

    // M3: Token abtippen, Übersicht sichtbar.
    await page.getByLabel("Device-Token").fill(token);
    await page.getByRole("button", { name: "Verbinden" }).click();
    await page.getByRole("heading", { name: "AncientVoid", exact: true }).waitFor();
    marks.M3 = Date.now() - t0;

    // M4: Probe-Session über den Erststart-Einstieg (T57.9) — die PWA öffnet die
    // Session direkt (kein Umweg über die Übersicht, wie erststart.spec.ts belegt).
    await page.getByRole("button", { name: "Probe-Session (dummy)" }).click();
    await page.locator(".session-topbar").first().waitFor();
    marks.M4 = Date.now() - t0;

    // M5: Nachricht aus der geöffneten Session heraus senden, im Verlauf sehen.
    await page.getByRole("button", { name: "Chat" }).click();
    const msg = `TTFS-Lauf ${index}: erste Steuerung vom Handy`;
    await page.getByPlaceholder("Antworten…").click(); // Composer expandiert (compact → offen), sonst gibt es den Sende-Knopf nicht
    await page.getByPlaceholder("Antworten…").fill(msg);
    // Laufende Session: Sende-Knopf heißt je Zustand „Weiter“ (running) oder
    // „Senden“ (Diagnose 13.11.2026) — beide zulassen, ersteres bevorzugt.
    const weiter = page.getByRole("button", { name: "Weiter", exact: true });
    const senden = page.getByRole("button", { name: "Senden", exact: true });
    await weiter.waitFor({ timeout: 15_000 }).then(() => weiter.click()).catch(() => senden.click());
    await page.locator(".tail-scroll").locator(".event.own").filter({ hasText: msg }).first().waitFor();
    marks.M5 = Date.now() - t0;

    // M5b (optional): Freigabe-Variante mit Stand-in-Harness, gemessen ab „Starten“.
    if (M5B) {
      await stopHub();
      await sh(
        "node",
        ["-e", 'const fs=require("node:fs");const f="hub.config.json";const c=JSON.parse(fs.readFileSync(f,"utf8"));if(!c.adapters.some(a=>a.id==="claude"))c.adapters.push({id:"claude",module:"@ancientvoid/adapter-claude"});fs.writeFileSync(f,JSON.stringify(c,null,2)+"\\n",{mode:0o600});'],
        { cwd: clone, timeoutMs: 30_000 },
      );
      const stubEnv = { ...hubEnv, PATH: `${clone}/e2e/support/bin:${process.env.PATH}` };
      await sh("bash", ["scripts/hub.sh", "start"], { cwd: clone, env: stubEnv, timeoutMs: 120_000 });
      await untilReady(origin, 120_000);
      const b0 = Date.now();
      await page.getByRole("button", { name: "Zur Übersicht" }).click();
      await page.getByRole("button", { name: "Neue Session" }).click();
      await page.getByLabel("Adapter").selectOption("claude");
      await page.getByPlaceholder("Refactore den Auth-Flow…").fill("Bitte WERKZEUG Erststart-M5b");
      await page.getByRole("button", { name: "Starten" }).click();
      await page.getByRole("button", { name: "Zur Übersicht" }).click();
      const decision = page.locator(".session-card").filter({ hasText: "Erststart-M5b" }).locator(".card-decision");
      await decision.getByRole("button", { name: "Erlauben" }).click();
      await page.getByText("Freigabe entschieden — Agent läuft weiter").waitFor();
      marks.M5b = Date.now() - b0; // ab „Starten“-Klick, nicht ab t0 (eigene Strecke)
    }
    await ctx.close();
  } catch (err) {
    // Diagnose bei Fehlschlag: Seitenzustand + Screenshot ins runDir (bleibt bei Fehlschlag erhalten).
    failed = true;
    if (activePage) {
      const shot = join(dir, "failure.png");
      await activePage.screenshot({ path: shot, fullPage: true }).catch(() => undefined);
      const text = await activePage.evaluate(() => document.body?.innerText?.() ?? "").catch(() => "");
      await (await import("node:fs/promises")).writeFile(join(dir, "failure.txt"), text).catch(() => undefined);
      process.stdout.write(`  FEHLER-DIAGNOSE: ${dir} (failure.png, failure.txt)\n`);
    }
    err.message = `${err.message}\n[redacted]\n${redact(String(err.message), token)}`;
    throw err;
  } finally {
    await stopHub();
    if (!KEEP && !failed) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
  return marks;
}

const median = (xs) => {
  const srt = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(srt.length / 2);
  return srt.length % 2 ? srt[mid] : (srt[mid - 1] + srt[mid]) / 2;
};

const browser = await chromium.launch({ executablePath: CHROMIUM_PATH });
const all = [];
try {
  for (let i = 1; i <= RUNS; i++) {
    process.stdout.write(`— Lauf ${i}/${RUNS} (Commit ${COMMIT.slice(0, 8)}) …\n`);
    const marks = await oneRun(i, browser);
    all.push(marks);
    for (const [m, v] of Object.entries(marks)) {
      process.stdout.write(`  ${m.padEnd(4)} ${m === "M5b" ? "(ab Starten)" : "(ab Klon-Start)"}: ${s(v)} = ${mins(v)}\n`);
    }
    process.stdout.write(`— Lauf ${i}/${RUNS} abgeschlossen\n`);
  }
} finally {
  await browser.close();
}

process.stdout.write(`\nTTFS über ${RUNS} Lauf/Läufe (Median, Min–Max):\n`);
for (const m of ["M0", "M1", "M2", "M3", "M4", "M5", ...(M5B ? ["M5b"] : [])]) {
  const xs = all.map((r) => r[m]).filter((x) => x !== undefined);
  if (!xs.length) continue;
  process.stdout.write(`  ${m.padEnd(4)} Median ${mins(median(xs))}  (${mins(Math.min(...xs))} – ${mins(Math.max(...xs))}, n=${xs.length})\n`);
}
