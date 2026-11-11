import { ADB_KNOWN_STATES } from "@ancientvoid/contracts";

/**
 * EPIC-P42 (ADR-0067): reine adb-/emulator-Helfer — Parser und argv-Vorlagen ohne Seiteneffekte, damit unit-testbar.
 * Parser-Port nach Review von stablyai/orca `src/main/emulator/android/adb-devices.ts` (Commit bdeb388d, MIT):
 * übernommen sind die Zweitonken-Sonderfälle („no permissions“) und die Override-before-Physical-Regel von
 * `wm size`; AV ergännt fail-loud-Zustände (`unknown` + rawState statt Stillschweigen) und lehnt unbekannte
 * Strukturzeilen nicht still ab. argv-Helfer sind eigene feste Vorlagen — keine freie Shell.
 */

export interface ParsedAdbDevice {
  serial: string;
  state: (typeof ADB_KNOWN_STATES)[number] | "unknown";
  rawState: string;
  usb: boolean;
  product: string | null;
  model: string | null;
  transportId: string | null;
}

const DEVICES_HEADER = "List of devices attached";

/**
 * `adb devices -l` auswerten. Bekannte Zustände werden übernommen; unbekannte Zustände bleiben als
 * `unknown` mit `rawState` sichtbar (fail loud). Zeilen ohne Serial werden übergangen — adb selbst
 * setzt den Header; etwas anderes wäre Formatverfall und wird über die leere Liste sichtbar.
 */
export function parseAdbDevices(stdout: string): ParsedAdbDevice[] {
  const devices: ParsedAdbDevice[] = [];
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.replace(/\r$/, "").trim();
    if (line === "" || line === DEVICES_HEADER) continue;
    const tokens = line.split(/\s+/);
    const serial = tokens[0] ?? "";
    if (!serial) continue;
    // „no permissions“ belegt zwei Zustands-Tokens vor den key:value-Metadaten (Orca-Port).
    let rawState: string;
    let tokenStart: number;
    if (tokens[1] === "no" && tokens[2] === "permissions") {
      rawState = "no permissions";
      tokenStart = 3;
    } else {
      rawState = tokens[1] ?? "";
      tokenStart = 2;
    }
    const product = { v: null as string | null };
    const model = { v: null as string | null };
    const transportId = { v: null as string | null };
    for (const token of tokens.slice(tokenStart)) {
      const sep = token.indexOf(":");
      if (sep === -1) continue;
      const key = token.slice(0, sep);
      const value = token.slice(sep + 1);
      if (key === "product") product.v = value;
      else if (key === "model") model.v = value;
      else if (key === "transport_id") transportId.v = value;
    }
    const known = (ADB_KNOWN_STATES as readonly string[]).includes(rawState);
    devices.push({
      serial,
      state: known ? (rawState as ParsedAdbDevice["state"]) : "unknown",
      rawState,
      usb: !serial.startsWith("emulator-"),
      product: product.v,
      model: model.v,
      transportId: transportId.v,
    });
  }
  return devices;
}

/** Override vor Physical — die Override-Größe ist die aktive Auflösung (Orca-Port). */
export function parseWmSize(stdout: string): { width: number; height: number } | null {
  const override = /Override size:\s*(\d+)x(\d+)/.exec(stdout);
  const physical = /Physical size:\s*(\d+)x(\d+)/.exec(stdout);
  const match = override ?? physical;
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}

export function isBootCompleted(getpropStdout: string): boolean {
  return getpropStdout.replace(/[\r\n]/g, "").trim() === "1";
}

/** PNG-IHDR lesen (Bytes 16–24) — die Geometrie eines Frames stammt aus dem Bild selbst, nie aus Annahmen. */
export function parsePngSize(buf: Uint8Array): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < signature.length; i++) if (buf[i] !== signature[i]) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** AVD-config.ini (Java-Properties): LCD-Größe und Image-Verzeichnis, sofern vorhanden. */
export function parseAvdConfigIni(text: string): { lcdWidth: number | null; lcdHeight: number | null; imageDir: string | null } {
  const props = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = /^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/.exec(line.replace(/\r$/, ""));
    if (m) props.set(m[1]!, m[2]!.trim());
  }
  const width = Number(props.get("hw.lcd.width"));
  const height = Number(props.get("hw.lcd.height"));
  return {
    lcdWidth: Number.isInteger(width) && width > 0 ? width : null,
    lcdHeight: Number.isInteger(height) && height > 0 ? height : null,
    imageDir: props.get("image.sysdir.1") ?? null,
  };
}

// ---- Text-/URL-Regeln für die Gerätesselle -----------------------------------------------------------------------
// adb shell fügt argv mit Leerzeichen wieder zu EINEM Shell-String zusammen: Metazeichen würden auf dem Gerät
// ausgewertet. Eingaben werden deshalb vorab auf eine ungefährliche Zeichenmenge gebracht und abgewiesen, wenn sie
// nicht hineinpassen (fail loud, EPIC-P42 §3.2 „keine freie adb shell“).

const DEVICE_SHELL_FORBIDDEN = /["'$`\\;,;&|<>()[\]{}*~]/;

/** `input text` übernimmt Leerzeichen nur als %s; „%“ selbst ist nicht escapbar und wird abgewiesen.
 * Leerzeichen sind erlaubt (werden zu %s), Tab/Steuerzeichen/Nicht-ASCII werden abgewiesen. */
export function encodeInputText(text: string): { ok: true; encoded: string } | { ok: false; reason: string } {
  if (text.includes("%")) return { ok: false, reason: "„%“ wird von der Gerätesshell für %s gebraucht und ist nicht übertragbar." };
  for (const ch of text) {
    if (ch === " ") continue;
    if (ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) > 0x7e) return { ok: false, reason: "Nur druckbare ASCII-Zeichen sind übertragbar (Umlaute/Sonderzeichen werden abgewiesen)." };
    if (DEVICE_SHELL_FORBIDDEN.test(ch)) return { ok: false, reason: `Zeichen „${ch}“ würde von der Gerätesshell ausgewertet und ist nicht erlaubt.` };
  }
  return { ok: true, encoded: text.split(" ").join("%s") };
}

/** http(s)-URL ohne Zeichen, die die Gerätesshell auswertet; Loopback wird vom Emulator aus erreicht. */
export function checkDeviceUrl(url: string): { ok: true; url: string } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "Keine gültige URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { ok: false, reason: "Nur http/https wird geöffnet." };
  if (parsed.username || parsed.password) return { ok: false, reason: "URLs mit Zugangsdaten werden abgewiesen." };
  for (const ch of url) {
    if (ch.charCodeAt(0) > 0x7e) return { ok: false, reason: "Nicht-ASCII-Zeichen in der URL werden abgewiesen." };
    if (ch !== "%" && DEVICE_SHELL_FORBIDDEN.test(ch)) return { ok: false, reason: `Zeichen „${ch}“ in der URL würde von der Gerätesshell ausgewertet.` };
  }
  return { ok: true, url: parsed.toString() };
}

// ---- argv-Vorlagen (fest; numerische Insertions sind vorab validiert) --------------------------------------------

export const adbDevicesArgv = (): string[] => ["devices", "-l"];
export const adbTapArgv = (serial: string, x: number, y: number): string[] => ["-s", serial, "shell", "input", "tap", String(Math.round(x)), String(Math.round(y))];
export const adbSwipeArgv = (serial: string, x1: number, y1: number, x2: number, y2: number, durationMs: number): string[] => [
  "-s", serial, "shell", "input", "swipe",
  String(Math.round(x1)), String(Math.round(y1)), String(Math.round(x2)), String(Math.round(y2)), String(durationMs),
];
export const adbTextArgv = (serial: string, encoded: string): string[] => ["-s", serial, "shell", "input", "text", encoded];

const KEYCODES = {
  back: "KEYCODE_BACK",
  home: "KEYCODE_HOME",
  "app-switch": "KEYCODE_APP_SWITCH",
  enter: "KEYCODE_ENTER",
  del: "KEYCODE_DEL",
  "volume-up": "KEYCODE_VOLUME_UP",
  "volume-down": "KEYCODE_VOLUME_DOWN",
} as const;
export const DEVICE_KEYS = Object.keys(KEYCODES) as (keyof typeof KEYCODES)[];
export const adbKeyArgv = (serial: string, key: keyof typeof KEYCODES): string[] => ["-s", serial, "shell", "input", "keyevent", KEYCODES[key]];

/** Rotation zweistufig: Auto-Rotation aus, dann feste Orientierung (0=portrait, 1=landscape). */
export const adbRotateArgv = (serial: string, orientation: "portrait" | "landscape"): string[][] => [
  ["-s", serial, "shell", "settings", "put", "system", "accelerometer_rotation", "0"],
  ["-s", serial, "shell", "settings", "put", "system", "user_rotation", orientation === "portrait" ? "0" : "1"],
];

export const adbOpenUrlArgv = (serial: string, url: string): string[] => ["-s", serial, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url];
export const adbPermissionArgv = (serial: string, pkg: string, permission: string, grant: boolean): string[] => [
  "-s", serial, "shell", "pm", grant ? "grant" : "revoke", pkg, permission,
];
export const adbScreencapArgv = (serial: string): string[] => ["-s", serial, "exec-out", "screencap", "-p"];
export const adbLogcatArgv = (serial: string, lines: number): string[] => ["-s", serial, "logcat", "-d", "-t", String(lines)];
export const adbTreeArgv = (serial: string): string[] => ["-s", serial, "exec-out", "uiautomator", "dump", "/dev/tty"];
export const adbGetpropArgv = (serial: string, name: string): string[] => ["-s", serial, "shell", "getprop", name];
export const adbWmSizeArgv = (serial: string): string[] => ["-s", serial, "shell", "wm", "size"];
export const adbInstallArgv = (serial: string, apkPath: string): string[] => ["-s", serial, "install", "-r", "-t", apkPath];
export const adbBootCompletedArgv = (serial: string): string[] => ["-s", serial, "shell", "getprop", "sys.boot_completed"];
export const adbEmuAvdNameArgv = (serial: string): string[] => ["-s", serial, "emu", "avd", "name"];

/** Emulator-Startargv: headless, ohne Snapshots (reproduzierbarer Startzustand), Software-GPU, fester Port. */
export function emulatorArgv(emulatorPath: string, avdName: string, port: number): string[] {
  return [
    emulatorPath, "-avd", avdName,
    "-no-window", "-no-audio", "-no-boot-anim", "-no-snapshot",
    "-gpu", "swiftshader_indirect", "-accel", "on",
    "-port", String(port),
  ];
}
