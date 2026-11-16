#!/usr/bin/env node
/**
 * EPIC-P62 T62.4 (AC-P62-2): erzeugt die Guide-Screenshots deterministisch —
 * Playwright gegen den Demo-Hub (T62.3-Seed, einzige Datenquelle), fester
 * Viewport, Ausgabe nach docs/guide/assets/<seite>-<nn>.png plus Hash-Datei
 * docs/guide/assets/hashes.json. Der CI-Abgleich (apps/pwa/test/
 * guide-inventory.test.ts + verify) macht veraltete Screenshots rot, bevor
 * der Guide-Text lügt.
 *
 * `npm run guide:shots` — baut die PWA frisch (wie das E2E-Gate), startet
 * den Demo-Hub auf einem freien Port, fotografiert jede Inventar-Seite.
 */
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const repoRoot = resolve(import.meta.dirname, "..");
const assetsDir = join(repoRoot, "docs/guide/assets");

/** Inventar-Seiten: [Datei-Basis, Hash-Route]. Views/Layer brauchen eine
 * geöffnete Session — der Seed legt sie an, wir öffnen die erste. */
const SHOTS: [string, string][] = [
  ["overview-01", "#/"],
  ["new-01", "#/neu"],
  ["settings-01", "#/einstellungen"],
  ["approvals-01", "#/freigaben"],
  ["status-01", "#/status"],
  ["media-01", "#/medien"],
  ["pc-01", "#/pc"],
  ["vault-01", "#/notizen"],
  ["teams-01", "#/teams"],
  ["automationen-01", "#/automationen"],
  ["aimetrics-01", "#/metriken"],
];

function sh(cmd: string, args: string[], opts: { cwd?: string } = {}): string {
  return execFileSync(cmd, args, { cwd: repoRoot, encoding: "utf8", stdio: "inherit", ...opts });
}

async function main() {
  // PWA frisch bauen — aber ins Guide-eigene `dist-guide`, damit ein Guide-Lauf das
  // Bündel des laufenden Hubs nicht überschreibt (BUG-0183). demo-seed holt sich das Bündel selbst.
  sh("npm", ["-w", "@ancientvoid/pwa", "run", "build", "--", "--outDir", "dist-guide", "--emptyOutDir"]);
  rmSync(assetsDir, { recursive: true, force: true });
  mkdirSync(assetsDir, { recursive: true });

  // Demo-Hub auf freiem Port (eigener Datenraum, nur Allowlist-Inhalt).
  const dataDir = join(tmpdir(), `ancientvoid-guide-shots-${Date.now()}`);
  const port = 4567;
  const hub = spawn(process.execPath, ["scripts/demo-seed.ts", "--port", String(port), "--data", dataDir], {
    cwd: repoRoot,
    env: { ...process.env, CI: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let token = "";
  hub.stdout.on("data", (d) => {
    const hit = /avt_[A-Za-z0-9_-]+/.exec(String(d));
    if (hit) token = hit[0];
  });
  hub.stderr.on("data", () => undefined);
  const deadline = Date.now() + 30_000;
  while (!token && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
  if (!token) throw new Error("Demo-Hub nicht bereit (kein Token gesehen)");

  try {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    // Token wie die E2E-Fixtures per addInitScript: vor jedem Seitenlauf,
    // bevor die App liest (BUG-0054-Lehre: niemals nachträglich setzen).
    await page.addInitScript((t) => {
      if (window.top === window) {
        localStorage.setItem("ancientvoid.token", t);
        localStorage.setItem("ancientvoid.typewriter", "0");
      }
    }, token);

    const hashes: Record<string, string> = {};
    for (const [name, route] of SHOTS) {
      await page.goto(`http://127.0.0.1:${port}/${route}`);
      await page.waitForTimeout(700); // erste Events/Animationen zur Ruhe bringen
      const file = join(assetsDir, `${name}.png`);
      await page.screenshot({ path: file, fullPage: false });
      hashes[`${name}.png`] = createHash("sha256").update(readFileSync(file)).digest("hex");
      console.log(`guide-shots: ${name}.png`);
    }
    // Session-Ansicht (view:tail): die laufende Session aus dem Seed öffnen.
    const sessions = await fetch(`http://127.0.0.1:${port}/api/sessions`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json());
    const running = sessions[0]?.id;
    if (running) {
      await page.goto(`http://127.0.0.1:${port}/#/sessions/${running}`);
      await page.waitForTimeout(900);
      const file = join(assetsDir, "session-01.png");
      await page.screenshot({ path: file });
      hashes["session-01.png"] = createHash("sha256").update(readFileSync(file)).digest("hex");
      console.log("guide-shots: session-01.png");
    }
    writeFileSync(join(assetsDir, "hashes.json"), `${JSON.stringify(hashes, null, 2)}\n`);
    await browser.close();
  } finally {
    hub.kill("SIGTERM");
  }
}

await main();
