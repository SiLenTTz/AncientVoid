import { FleetSettings } from "../fleet/Fleet.tsx";
import { GeminiSettings } from "./GeminiSettings.tsx";
import { PcInput } from "./PcInput.tsx";
import { PushSettings } from "./PushSettings.tsx";
import { Settings } from "./Settings.tsx";

/** Die Einstellungen als eine Seite — dieselbe am Handy (Listenseite) und am Desktop (Werkzeugfläche). */
export function SettingsPage({ onSwitchToken }: { onSwitchToken: () => void }) {
  return (
    <div class="settings-page">
      <Settings onSwitchToken={onSwitchToken} />
      <FleetSettings />
      <PushSettings />
      <GeminiSettings />
      <PcInput />
    </div>
  );
}
