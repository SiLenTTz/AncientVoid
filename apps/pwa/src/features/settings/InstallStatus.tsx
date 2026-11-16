import { useEffect, useState } from "preact/hooks";
import { deviceStatusLines, gatherDeviceStatus } from "../../shared/device-status.ts";
import { SettingRow } from "./parts.tsx";

/**
 * BUG-0185: der installierte Stand ist auf dem Handy ablesbar. Wer dreht und es dreht
 * sich nichts, sieht hier in vier Zeilen, ob die App installiert läuft, welche
 * Ausrichtung ihr Fenster hat, was ihr Manifest sagt und ob ein Service Worker das
 * Manifest festhält. Der Knopf prüft nach „Worker aktualisiert“ oder nach dem
 * Neuanlegen des Startsymbols erneut.
 */
export function InstallStatus() {
  const [lines, setLines] = useState<string[] | null>(null);
  const [check, setCheck] = useState(0);
  useEffect(() => {
    let alive = true;
    const run = () =>
      gatherDeviceStatus()
        .then((status) => alive && setLines(deviceStatusLines(status)))
        .catch(() => alive && setLines(["Stand nicht lesbar"]));
    run();
    // Nach einem Worker-Wechsel (BUG-0185: alte Stufe hatte das Manifest einbetoniert)
    // liest sich der Stand von selbst neu — sonst stünde dort eine alte Antwort.
    const sw = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
    sw?.addEventListener?.("controllerchange", run);
    return () => {
      alive = false;
      sw?.removeEventListener?.("controllerchange", run);
    };
  }, [check]);
  return (
    <SettingRow label="Installierter Stand" hint="Was auf diesem Gerät wirklich gilt — Ausrichtung, Manifest und der Cache dahinter">
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
      </div>
    </SettingRow>
  );
}
