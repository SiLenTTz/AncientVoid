import { useEffect, useState } from "preact/hooks";
import { APPEARANCE_EVENT, DEFAULT_APPEARANCE, getAppearance, isDefaultAppearance, setAppearance } from "../../app/appearance.ts";
import { StatusDot } from "../../shared/StatusDot.tsx";
import { SettingsSection } from "./parts.tsx";
import { Button } from "../../shared/ui/index.ts";

/**
 * Gruppe „Vorschau“: ein kleiner Chat mit den echten Klassen der Oberfläche — Akzent, Oberflächen- und
 * Codeschrift, Status-Farben —, damit jede Änderung ohne Seitenwechsel zu sehen ist.
 */
export function PreviewSettings() {
  const [custom, setCustom] = useState(!isDefaultAppearance(getAppearance()));
  useEffect(() => {
    const sync = () => setCustom(!isDefaultAppearance(getAppearance()));
    window.addEventListener(APPEARANCE_EVENT, sync);
    return () => window.removeEventListener(APPEARANCE_EVENT, sync);
  }, []);
  return (
    <SettingsSection title="Vorschau" class="settings-preview">
      <div class="preview-chat" aria-hidden="true">
        <div class="event user own">
          <div class="summary prose">Du: Bitte mach den fehlschlagenden Test grün.</div>
        </div>
        <p class="preview-text">
          Ich habe die Ursache gefunden: der Timer wird zu früh gelöscht. <code class="preview-code">clearTimeout(handle)</code> steht jetzt nach dem <strong>await</strong>.
        </p>
        <pre class="preview-diff">{"- clearTimeout(handle);\n+ await flush();\n+ clearTimeout(handle);"}</pre>
        <div class="preview-chips">
          <StatusDot status="working" />
          <StatusDot status="waiting_approval" />
          <StatusDot status="waiting_approval" question />
          <StatusDot status="idle" unseen />
          <StatusDot status="error" />
          <StatusDot status="idle" />
          <span class="ui-button ui-button--primary preview-button">Senden</span>
          <span class="preview-link">Link</span>
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-label">
          <span class="setting-title">Darstellung zurücksetzen</span>
          <span class="dim setting-hint">Akzentfarbe, Schriftarten und Schriftgröße; Theme und Zoom bleiben</span>
        </div>
        <div class="setting-control">
          <Button disabled={!custom} onClick={() => setAppearance(DEFAULT_APPEARANCE)}>
            Zurücksetzen
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
}
