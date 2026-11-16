import { DeviceTestCase, type DeviceTestState } from "@ancientvoid/contracts";

/** EPIC-P42 (ADR-0067): reine Hilfen des Geräte-Panels — ohne DOM, damit unit-testbar. */

/** Klick auf das skalierte Standbild → Koordinaten in Geräte-Pixeln. Die Bildgröße stammt aus dem PNG selbst,
 * deshalb ist die Abbildung rotationsfest: ein quer gelegtes Bild wird über seine echten Maße getroffen. */
export function toDevicePoint(click: { x: number; y: number }, box: { left: number; top: number; width: number; height: number }, natural: { width: number; height: number }): { x: number; y: number } | null {
  if (box.width <= 0 || box.height <= 0 || natural.width <= 0 || natural.height <= 0) return null;
  const rx = (click.x - box.left) / box.width;
  const ry = (click.y - box.top) / box.height;
  if (rx < 0 || rx > 1 || ry < 0 || ry > 1) return null;
  return { x: Math.round(rx * natural.width), y: Math.round(ry * natural.height) };
}

export const EMU_STATE_LABEL: Record<string, string> = {
  starting: "startet",
  booting: "bootet",
  ready: "bereit",
  stopping: "wird beendet",
  stopped: "beendet",
  unknown: "unbekannt",
};

export const ADB_STATE_LABEL: Record<string, string> = {
  device: "online",
  offline: "offline",
  unauthorized: "nicht autorisiert — USB-Debugging auf dem Gerät bestätigen",
  bootloader: "Bootloader",
  recovery: "Recovery",
  "no permissions": "keine Rechte — udev/ADB-Konfiguration prüfen",
  "no-device": "getrennt",
  unknown: "unbekannter Zustand",
};

export const TEST_STATE_LABEL: Record<DeviceTestState, string> = {
  running: "läuft",
  passed: "bestanden",
  failed: "fehlgeschlagen",
  aborted: "abgebrochen",
  unknown: "unbekannt",
};

export const EXAMPLE_TEST = JSON.stringify(
  {
    name: "PWA im Emulator-Browser öffnen",
    serial: "emulator-5554",
    steps: [
      { type: "openUrl", url: "http://10.0.2.2:3000/", timeoutMs: 10000 },
      { type: "expectText", text: "AncientVoid", timeoutMs: 12000 },
    ],
  },
  null,
  2,
);

/** Testfall aus dem Editor — mit verständlicher Fehlermeldung statt rohem Zod-Dump. */
export function parseTestCase(text: string): { ok: true; test: DeviceTestCase } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `Kein gültiges JSON: ${err instanceof Error ? err.message : "Syntaxfehler"}` };
  }
  const parsed = DeviceTestCase.safeParse(raw);
  if (parsed.success) return { ok: true, test: parsed.data };
  const issue = parsed.error.issues[0];
  return { ok: false, error: `Ungültiger Testfall: ${issue?.path.join(".") || "Wurzel"} — ${issue?.message ?? "unbekannt"}` };
}
