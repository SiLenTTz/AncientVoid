import { FleetSettings } from "../fleet/Fleet.tsx";
import { AppearanceSettings } from "./AppearanceSettings.tsx";
import { ConnectionsSettings } from "./ConnectionsSettings.tsx";
import { DevicesSettings } from "./DevicesSettings.tsx";
import { FontSettings } from "./FontSettings.tsx";
import { GeminiSettings } from "./GeminiSettings.tsx";
import { PreviewSettings } from "./PreviewSettings.tsx";
import { PushSettings } from "./PushSettings.tsx";
import { SecuritySettings } from "./SecuritySettings.tsx";

/**
 * Die Einstellungen als eine Seite — dieselbe am Handy (Listenseite) und am Desktop (Werkzeugfläche).
 * Zwei gleich breite Spalten, sobald der Platz reicht (Container-Abfrage, nicht Fenster-Abfrage:
 * in der Werkzeugfläche ist der Platz nicht die Fensterbreite). Die Reihenfolge der DOM-Knoten
 * ist zugleich die Reihenfolge am Handy.
 */
export function SettingsPage({ onSwitchToken }: { onSwitchToken: () => void }) {
  return (
    <div class="settings-page">
      <div class="settings-cols">
        <div class="settings-col">
          <AppearanceSettings />
          <FontSettings />
          <PreviewSettings />
          <PushSettings />
        </div>
        <div class="settings-col">
          <DevicesSettings />
          <FleetSettings />
          <ConnectionsSettings />
          <GeminiSettings />
          <SecuritySettings onSwitchToken={onSwitchToken} />
        </div>
      </div>
    </div>
  );
}
