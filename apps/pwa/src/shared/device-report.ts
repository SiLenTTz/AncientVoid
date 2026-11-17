import { getToken } from "./api.ts";
import { BUILD_SHA } from "./build-id.ts";
import { gatherDeviceStatus, type DeviceStatus } from "./device-status.ts";

/**
 * BUG-0186: Was das Gerät über seine Ausrichtung misst, gehört in das Hub-Protokoll, nicht
 * auf ein Display, das jemand ablesen muss. Ein Knopfdruck auf „Stand neu prüfen“ genügt —
 * der Bericht geht von selbst mit, und auf dem Rechner steht eine Zeile mit Winkel,
 * Anzeigemodus, Manifest und Fenstergröße.
 */
export type ReportHow = "gelockt" | "entsperrt" | "abgewiesen" | "keine-api" | "nicht-versucht";

const DISPLAY_MODE: Record<DeviceStatus["displayMode"], "standalone" | "browser" | undefined> = {
  "installiert (eigenes Fenster)": "standalone",
  "Browser-Tab": "browser",
  unbekannt: undefined,
};

/** Der korperbegrenzte Bericht aus gesammeltem Stand + Ausrichter-Ergebnis. */
export function orientationReportBody(status: DeviceStatus, how: ReportHow, detail: string) {
  const win = typeof window !== "undefined" ? window : undefined;
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  return {
    kind: "orientation" as const,
    angle: status.windowAngle ?? readAngle(),
    how,
    detail: detail.slice(0, 200),
    displayMode: DISPLAY_MODE[status.displayMode],
    manifestOrientation: String(status.manifestOrientation).slice(0, 40),
    width: win ? Math.round(win.innerWidth) : undefined,
    height: win ? Math.round(win.innerHeight) : undefined,
    devicePixelRatio: win?.devicePixelRatio,
    platform: (nav as { userAgentData?: { platform?: string } } | undefined)?.userAgentData?.platform ?? nav?.platform,
    userAgent: nav?.userAgent?.slice(0, 300),
    /** Welches Buendel auf diesem Geraet laeuft — der Server sieht nur, was er ausliefert. */
    build: BUILD_SHA.slice(0, 40),
  };
}

function readAngle(): number {
  if (typeof screen === "undefined") return 0;
  const angle = (screen as { orientation?: { angle?: unknown } }).orientation?.angle;
  return typeof angle === "number" ? Math.round(angle) : 0;
}

/**
 * Ein Bericht, best-effort: scheitert er (offline, kein Token), ist das keine
 * Nutzererscheinung — die Anzeige bleibt, wie sie war, und die Funktion der App ändert
 * sich nicht. Der Aufrufer wartet nicht darauf.
 */
export async function sendOrientationReport(how: ReportHow, detail: string, status?: DeviceStatus): Promise<boolean> {
  try {
    const s = status ?? (await gatherDeviceStatus());
    const token = getToken();
    if (!token) return false;
    const res = await fetch("/api/diagnostics/client-report", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(orientationReportBody(s, how, detail)),
    });
    return res.ok;
  } catch {
    return false;
  }
}
