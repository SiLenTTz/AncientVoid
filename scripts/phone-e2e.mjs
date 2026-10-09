#!/usr/bin/env node
/**
 * E2E-Specs auf dem echten Handy (Android, Chrome) — `npm run test:phone [-- playwright-args]`.
 *
 * Voraussetzung: Handy per adb verbunden (USB oder drahtlos), entsperrt, Chrome installiert.
 * Das Skript startet Chrome, leitet dessen DevTools-Socket per `adb forward` auf den PC und lässt
 * Playwright die Specs des Projekts `phone` darin ausführen. Es ändert keine Handy-Einstellungen
 * und entsperrt nichts. Jeder Test öffnet einen eigenen Tab und schließt ihn wieder.
 *
 * Umgebung: UACC_PHONE_SERIAL wählt ein bestimmtes Gerät.
 */
/* global fetch, AbortSignal */
import { execFileSync, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { quarterFromDumpsys } from "./phone-run-guard.mjs";

const deadFlag = join(tmpdir(), "uacc-phone-cdp-dead");
rmSync(deadFlag, { force: true });

const adbRaw = (args, opts = {}) => execFileSync("adb", args, { encoding: "utf8", timeout: 20_000, ...opts });

function pickSerial() {
  if (process.env.UACC_PHONE_SERIAL) return process.env.UACC_PHONE_SERIAL;
  const lines = adbRaw(["devices"]).split("\n").slice(1).filter((l) => /\tdevice$/.test(l));
  if (lines.length === 0) throw new Error("Kein Handy per adb verbunden (`adb devices` ist leer).");
  return lines[0].split("\t")[0];
}

const serial = pickSerial();
const adb = (...args) => adbRaw(["-s", serial, ...args]);
const model = adb("shell", "getprop", "ro.product.model").trim();
console.log(`Handy: ${model} (${serial})`);

// Wach und entsperrt? Entsperren kann und soll das Skript nicht.
const power = adb("shell", "dumpsys", "power");
if (!/mWakefulness=Awake/.test(power)) {
  adb("shell", "input", "keyevent", "KEYCODE_WAKEUP");
  await new Promise((r) => setTimeout(r, 1500));
}
const window = adb("shell", "dumpsys", "window");
if (/isKeyguardShowing=true|mDreamingLockscreen=true/.test(window)) {
  console.error("Das Handy ist gesperrt. Bitte entsperren und noch einmal starten.");
  process.exit(2);
}

// Hochformat? Im Querformat hat die Seite nur ~450 px Höhe; Messungen und Klicks wären nicht vergleichbar.
// Standardmäßig wird die Ausrichtung NICHT verändert (das ist die Einstellung der Person). Mit `--portrait`
// stellt das Skript die Drehung für die Dauer des Laufs auf Hochformat und danach exakt zurück.
const portraitFlag = process.argv.includes("--portrait");
const passthrough = process.argv.slice(2).filter((a) => a !== "--portrait");
const getSetting = (key) => adb("shell", "settings", "get", "system", key).trim();
let restoreRotation = () => {};
const quarter = () => quarterFromDumpsys(adb("shell", "dumpsys", "window", "displays"));
if (quarter() === "1" || quarter() === "3") {
  if (!portraitFlag) {
    console.error("Das Handy liegt im Querformat. Bitte aufrecht halten oder mit `--portrait` starten (stellt die Drehung nur für den Lauf um).");
    process.exit(2);
  }
  const before = { auto: getSetting("accelerometer_rotation"), user: getSetting("user_rotation") };
  adb("shell", "settings", "put", "system", "accelerometer_rotation", "0");
  adb("shell", "settings", "put", "system", "user_rotation", "0");
  restoreRotation = () => {
    try {
      adb("shell", "settings", "put", "system", "user_rotation", before.user === "null" ? "0" : before.user);
      adb("shell", "settings", "put", "system", "accelerometer_rotation", before.auto === "null" ? "1" : before.auto);
      console.log(`Drehung wiederhergestellt (accelerometer_rotation=${before.auto}, user_rotation=${before.user}).`);
    } catch (err) {
      console.error("Drehung konnte nicht wiederhergestellt werden:", err instanceof Error ? err.message : err);
    }
  };
  process.on("SIGINT", () => {
    restoreRotation();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    restoreRotation();
    process.exit(143);
  });
  await new Promise((r) => setTimeout(r, 1500));
  console.log("Drehung für den Lauf auf Hochformat gestellt.");
}

// Chrome öffnen. Der Socket `chrome_devtools_remote` ohne Zahl gehört oft einem ANDEREN Browser
// (Brave, Edge …) — gesteuert wird nur ein Socket, dessen `Android-Package` com.android.chrome ist.
const PACKAGE = "com.android.chrome";
adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "about:blank", "-p", PACKAGE);

async function findChromeSocket() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const sockets = [...new Set(adb("shell", "cat", "/proc/net/unix").match(/@[A-Za-z0-9_.]*devtools_remote[A-Za-z0-9_.]*/g) ?? [])];
    for (const socket of sockets) {
      const port = adb("forward", "tcp:0", `localabstract:${socket.slice(1)}`).trim();
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(4000) });
        const info = await res.json();
        if (info["Android-Package"] === PACKAGE) return { port, socket };
      } catch {
        // dieser Socket antwortet nicht — nächster
      }
      adb("forward", "--remove", `tcp:${port}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

const found = await findChromeSocket();
if (!found) {
  console.error(`Kein DevTools-Socket von ${PACKAGE} auf dem Handy gefunden (USB-Debugging an? Chrome gestartet?).`);
  process.exit(3);
}
const { port, socket } = found;
console.log(`${PACKAGE}: ${socket} → 127.0.0.1:${port}`);

const args = ["playwright", "test", "--project=phone", "--workers=1", ...passthrough];
const result = spawnSync("npx", args, {
  stdio: "inherit",
  env: { ...process.env, UACC_E2E_CDP: `http://127.0.0.1:${port}`, UACC_PHONE_SERIAL: serial, UACC_PHONE_LOCK_PORTRAIT: "1" },
});
try {
  adb("forward", "--remove", `tcp:${port}`);
} catch {
  // schon weg
}
restoreRotation();
process.exit(result.status ?? 1);
