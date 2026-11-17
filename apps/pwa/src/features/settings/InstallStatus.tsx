import { useEffect, useState } from "preact/hooks";
import { deviceStatusLines, gatherDeviceStatus } from "../../shared/device-status.ts";
import { lockOrientation, type OrientationTarget } from "../../shared/orientation-lock.ts";
import { SettingRow } from "./parts.tsx";

/**
 * BUG-0186: der installierte Stand ist auf dem Handy ablesbar. Wer dreht und es dreht
 * sich nichts, sieht hier in vier Zeilen, ob die App installiert läuft, welche
 * Ausrichtung ihr Fenster hat, was ihr Manifest sagt und ob ein Service Worker das
 * Manifest festhält. Der Knopf prüft nach „Worker aktualisiert“ oder nach dem
 * Neuanlegen des Startsymbols erneut.
 */
export function InstallStatus() {
  const [lines, setLines] = useState<string[] | null>(null);
  const [check, setCheck] = useState(0);
  const [lockMsg, setLockMsg] = useState<string | null>(null);

  async function orient(target: OrientationTarget) {
    const res = await lockOrientation(target);
    setLockMsg(res.detail);
    await new Promise((r) => setTimeout(r, 300)); // die Ausrichtungs-Abfrage braucht einen Moment
    try {
      setLines(deviceStatusLines(await gatherDeviceStatus()));
    } catch {
      /* die vorigen Zeilen bleiben stehen */
    }
  }

  useEffect(() => {
    let alive = true;
    const run = () =>
      gatherDeviceStatus()
        .then((status) => alive && setLines(deviceStatusLines(status)))
        .catch(() => alive && setLines(["Stand nicht lesbar"]));
    run();
    // Nach einem Worker-Wechsel (BUG-0186: alte Stufe hatte das Manifest einbetoniert)
    // liest sich der Stand von selbst neu — sonst stünde dort eine alte Antwort.
    const sw = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
    sw?.addEventListener?.("controllerchange", run);
    return () => {
      alive = false;
      sw?.removeEventListener?.("controllerchange", run);
    };
  }, [check]);
  return (
    <SettingRow label="Installierter Stand" hint="Anzeigemodus, Ausrichtung, Manifest und die Worker-Stufe dahinter">
      <div class="install-status" data-testid="install-status">
        {lines === null ? (
          <span class="dim">geprüft…</span>
        ) : (
          lines.map((line) => (
            <div class="install-status__line dim" key={line}>
              {line}
            </div>
          ))
        )}
        <button class="btn" data-testid="install-status-refresh" onClick={() => setCheck((n) => n + 1)}>
          Stand neu prüfen
        </button>
        <span class="settings-row-actions">
          <button class="btn small" data-testid="install-orient-landscape" onClick={() => void orient("landscape")}>
            Querformat erzwingen
          </button>
          <button class="btn small" data-testid="install-orient-auto" onClick={() => void orient("any")}>
            Wieder automatisch
          </button>
        </span>
        {lockMsg !== null && (
          <div class="install-status__line" data-testid="install-orient-result">
            {lockMsg}
          </div>
        )}
      </div>
    </SettingRow>
  );
}
