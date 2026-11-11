import { useEffect, useState } from "preact/hooks";
import { applyTheme, getTheme, type Theme } from "../../app/theme.ts";
import { applyCtxMotion, ctxMotionOn, getScale, setScale, SCALE_MAX, SCALE_MIN, SCALE_STEP } from "../../app/ui-scale.ts";
import { AccentSetting } from "./AccentPicker.tsx";
import { SettingRow, SettingsSection, Segmented, Switch } from "./parts.tsx";

/** Gruppe „Darstellung“: Theme, Zoom, Bewegung. Akzent und Schrift kommen mit T34.5/T34.6 hierher. */
export function AppearanceSettings() {
  const [theme, setThemeState] = useState<Theme>(getTheme());
  // EPIC-P20: the scale changes from the keyboard and wheel too — follow it.
  const [scale, setScaleState] = useState<number>(getScale());
  const [motion, setMotion] = useState<boolean>(ctxMotionOn());
  useEffect(() => {
    const on = (e: Event) => setScaleState((e as CustomEvent<number>).detail);
    window.addEventListener("ancientvoid:scale", on);
    return () => window.removeEventListener("ancientvoid:scale", on);
  }, []);

  return (
    <SettingsSection title="Darstellung">
      <SettingRow label="Erscheinungsbild">
        <Segmented
          label="Erscheinungsbild"
          value={theme}
          options={[
            { value: "dark", label: "Dunkel" },
            { value: "light", label: "Hell" },
          ]}
          onChange={(next) => {
            applyTheme(next);
            setThemeState(next);
          }}
        />
      </SettingRow>
      <AccentSetting />
      <SettingRow label="Zoom der Oberfläche" hint="Strg + Mausrad, Strg + / − , Strg + 0">
        <span class="scale-control">
          <button class="btn" aria-label="Kleiner" title="Kleiner" disabled={scale <= SCALE_MIN} onClick={() => setScale(scale - SCALE_STEP)}>
            −
          </button>
          <span class="scale-value mono" aria-live="polite">
            {Math.round(scale * 100)} %
          </span>
          <button class="btn" aria-label="Größer" title="Größer" disabled={scale >= SCALE_MAX} onClick={() => setScale(scale + SCALE_STEP)}>
            +
          </button>
          <button class="btn" disabled={scale === 1} onClick={() => setScale(1)}>
            100 %
          </button>
        </span>
      </SettingRow>
      <SettingRow label="Bewegung" hint="Atmen, Schimmer, Ruf und Übergänge; „Bewegung reduzieren“ des Systems schaltet sie immer ab">
        <Switch
          label="Bewegung"
          checked={motion}
          onChange={(next) => {
            applyCtxMotion(next);
            setMotion(next);
          }}
        />
      </SettingRow>
    </SettingsSection>
  );
}
