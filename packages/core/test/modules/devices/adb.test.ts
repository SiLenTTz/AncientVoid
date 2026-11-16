import { describe, expect, it } from "vitest";
import {
  adbDevicesArgv,
  adbKeyArgv,
  adbOpenUrlArgv,
  adbRotateArgv,
  adbScreencapArgv,
  adbTapArgv,
  adbTextArgv,
  checkDeviceUrl,
  encodeInputText,
  emulatorArgv,
  isBootCompleted,
  parseAdbDevices,
  parseAvdConfigIni,
  parsePngSize,
  parseWmSize,
} from "@ancientvoid/core";

/** EPIC-P42 (ADR-0067): adb-Parser und argv-Vorlagen. Parser-Port nach Review von stablyai/orca
 * (Commit bdeb388d, MIT) — hier mit eigenen Negativfällen: unbekannte Zustände bleiben sichtbar. */
describe("parseAdbDevices (T42.2)", () => {
  it("wertet `adb devices -l` vollständig aus (Emulator, Metadata, transport_id)", () => {
    const out = [
      "List of devices attached",
      "emulator-5556          device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emu64xa transport_id:1",
      "",
    ].join("\n");
    const rows = parseAdbDevices(out);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ serial: "emulator-5556", state: "device", rawState: "device", usb: false, product: "sdk_gphone64_x86_64", model: "sdk_gphone64_x86_64", transportId: "1" });
  });

  it("offline und unauthorized sind eigene Zustände (fail loud, kein Stillschweigen)", () => {
    const rows = parseAdbDevices("List of devices attached\nXA5312\tunauthorized transport_id:2\nusb1\toffline transport_id:3\n");
    expect(rows.map((r) => r.state)).toEqual(["unauthorized", "offline"]);
    expect(rows[0]!.usb).toBe(true);
  });

  it("„no permissions“ belegt zwei Tokens (Orca-Sonderfall)", () => {
    const rows = parseAdbDevices("List of devices attached\nHT123       no permissions (user in plugdev group); see [http://...] transport_id:4\n");
    expect(rows[0]).toMatchObject({ state: "no permissions", rawState: "no permissions" });
  });

  it("unbekannter Zustand bleibt als `unknown` mit rawState sichtbar — nie gedropft", () => {
    const rows = parseAdbDevices("List of devices attached\ndevice9\tsideload transport_id:5\n");
    expect(rows[0]).toMatchObject({ state: "unknown", rawState: "sideload" });
  });

  it("Leerzeilen und Header sind keine Geräte, beschädigte Zeilen ohne Serial werden übergangen", () => {
    expect(parseAdbDevices("")).toEqual([]);
    expect(parseAdbDevices("List of devices attached\n\n")).toEqual([]);
  });
});

describe("wm size / boot / PNG / AVD-config (T42.2)", () => {
  it("Override-Größe schlägt Physical (Orca-Port)", () => {
    expect(parseWmSize("Physical size: 1080x2400\nOverride size: 2400x1080\n")).toEqual({ width: 2400, height: 1080 });
    expect(parseWmSize("Physical size: 1080x2400\n")).toEqual({ width: 1080, height: 2400 });
    expect(parseWmSize("kaputt")).toBeNull();
  });

  it("boot_completed toleriert \\r\\n und lehnt alles andere als ungebootet ab", () => {
    expect(isBootCompleted("1\r\n")).toBe(true);
    expect(isBootCompleted("\r\n")).toBe(false);
    expect(isBootCompleted("0\n")).toBe(false);
  });

  it("PNG-Größe kommt aus dem IHDR des Bildes selbst — nicht aus Annahmen", () => {
    const png = Buffer.alloc(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    png.writeUInt32BE(1080, 16);
    png.writeUInt32BE(2400, 20);
    expect(parsePngSize(png)).toEqual({ width: 1080, height: 2400 });
    expect(parsePngSize(Buffer.from("kein png"))).toBeNull();
    expect(parsePngSize(Buffer.alloc(8))).toBeNull();
  });

  it("AVD-config.ini liest LCD-Größe und Image-Verzeichnis, fehlende Felder bleiben null", () => {
    expect(parseAvdConfigIni("hw.lcd.width=1080\nhw.lcd.height=2400\nimage.sysdir.1=system-images/android-35/\n")).toEqual({ lcdWidth: 1080, lcdHeight: 2400, imageDir: "system-images/android-35/" });
    expect(parseAvdConfigIni("")).toEqual({ lcdWidth: null, lcdHeight: null, imageDir: null });
  });
});

describe("Text-/URL-Regeln für die Gerätesselle (T42.2, keine freie adb shell)", () => {
  it("Leerzeichen werden als %s übertragen", () => {
    expect(encodeInputText("Hallo Welt")).toEqual({ ok: true, encoded: "Hallo%sWelt" });
    expect(encodeInputText("a  b")).toEqual({ ok: true, encoded: "a%s%sb" });
  });

  it("„%“, Shell-Metazeichen und Nicht-ASCII werden abgewiesen (fail loud)", () => {
    expect(encodeInputText("100%").ok).toBe(false);
    expect(encodeInputText("a;b").ok).toBe(false);
    expect(encodeInputText("a&b").ok).toBe(false);
    expect(encodeInputText('a"b').ok).toBe(false);
    expect(encodeInputText("a$(x)").ok).toBe(false);
    expect(encodeInputText("schön").ok).toBe(false); // Umlaut
    expect(encodeInputText("tab\tchar").ok).toBe(false);
  });

  it("URLs: nur http/https ohne Zugangsdaten und ohne shell-wirksame Zeichen", () => {
    expect(checkDeviceUrl("http://10.0.2.2:3000/").ok).toBe(true);
    expect(checkDeviceUrl("http://10.0.2.2/pfad?x=1&y=2").ok).toBe(false); // & würde die Gerätessell auswerten
    expect(checkDeviceUrl("http://10.0.2.2/pfad?x=1").ok).toBe(true); // ? und = sind für Query-Strings erlaubt
    expect(checkDeviceUrl("file:///etc/passwd").ok).toBe(false);
    expect(checkDeviceUrl("http://u:p@10.0.2.2/").ok).toBe(false);
    expect(checkDeviceUrl("notaurl").ok).toBe(false);
  });
});

describe("argv-Vorlagen (T42.2)", () => {
  it("adb-argv ist fest: Serial, Unterbefehl, validierte Insertions — kein Shell-String", () => {
    expect(adbDevicesArgv()).toEqual(["devices", "-l"]);
    expect(adbTapArgv("emulator-5554", 540, 1200)).toEqual(["-s", "emulator-5554", "shell", "input", "tap", "540", "1200"]);
    expect(adbTextArgv("emulator-5554", "Hallo%sWelt")).toEqual(["-s", "emulator-5554", "shell", "input", "text", "Hallo%sWelt"]);
    expect(adbKeyArgv("emulator-5554", "back")).toEqual(["-s", "emulator-5554", "shell", "input", "keyevent", "KEYCODE_BACK"]);
    expect(adbScreencapArgv("emulator-5554")).toEqual(["-s", "emulator-5554", "exec-out", "screencap", "-p"]);
    expect(adbOpenUrlArgv("emulator-5554", "http://10.0.2.2:3000/")).toEqual(["-s", "emulator-5554", "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "http://10.0.2.2:3000/"]);
  });

  it("Rotation ist zweistufig (Auto-Rotation aus, dann Orientierung)", () => {
    expect(adbRotateArgv("emulator-5554", "landscape")).toEqual([
      ["-s", "emulator-5554", "shell", "settings", "put", "system", "accelerometer_rotation", "0"],
      ["-s", "emulator-5554", "shell", "settings", "put", "system", "user_rotation", "1"],
    ]);
  });

  it("Emulator-Start ist headless, snapshot-frei und mit festem Port (reproduzierbarer Startzustand)", () => {
    expect(emulatorArgv("/sdk/emulator/emulator", "av-test", 5554)).toEqual([
      "/sdk/emulator/emulator",
      "-avd",
      "av-test",
      "-no-window",
      "-no-audio",
      "-no-boot-anim",
      "-no-snapshot",
      "-gpu",
      "swiftshader_indirect",
      "-accel",
      "on",
      "-port",
      "5554",
    ]);
  });
});
