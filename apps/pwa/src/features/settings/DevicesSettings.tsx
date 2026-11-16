import { useState } from "preact/hooks";
import { applyPinchZoom, pinchZoomAllowed } from "../../app/zoom.ts";
import { PcInput } from "./PcInput.tsx";
import { SettingRow, SettingsSection, Switch } from "./parts.tsx";

/** Gruppe „Geräte“: was dieses Gerät und der PC daneben dürfen. */
export function DevicesSettings() {
  const [zoom, setZoom] = useState<boolean>(pinchZoomAllowed());
  return (
    <SettingsSection title="Geräte">
      <SettingRow label="Pinch-Zoom" hint="Feld-Zoom bleibt aus">
        <Switch
          label="Pinch-Zoom"
          checked={zoom}
          onChange={(next) => {
            applyPinchZoom(next);
            setZoom(next);
          }}
        />
      </SettingRow>
      <PcInput />
    </SettingsSection>
  );
}
