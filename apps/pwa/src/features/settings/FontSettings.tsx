import { useEffect, useState } from "preact/hooks";
import { APPEARANCE_EVENT, clampFontScale, FONT_SCALE_MAX, FONT_SCALE_MIN, FONT_SCALE_STEP, FONTS, getAppearance, setAppearance, type FontId } from "../../app/appearance.ts";
import { SettingRow, SettingsSection } from "./parts.tsx";

function useAppearance() {
  const [appearance, setState] = useState(getAppearance());
  useEffect(() => {
    const sync = () => setState(getAppearance());
    window.addEventListener(APPEARANCE_EVENT, sync);
    return () => window.removeEventListener(APPEARANCE_EVENT, sync);
  }, []);
  return appearance;
}

/** Jeder Eintrag ist in seiner eigenen Schrift gesetzt, die Wahl wirkt sofort (Vorschau daneben). */
function FontChoices({ label, value, onPick, monoOnly }: { label: string; value: FontId; onPick: (id: FontId) => void; monoOnly?: boolean }) {
  return (
    <div class="font-choices" role="radiogroup" aria-label={label}>
      {FONTS.filter((f) => !monoOnly || f.mono).map((f) => (
        <button key={f.id} type="button" role="radio" aria-checked={f.id === value} class={`font-choice${f.id === value ? " active" : ""}`} style={{ fontFamily: f.stack }} onClick={() => onPick(f.id)}>
          <span class="font-sample" aria-hidden="true">
            Aa
          </span>
          <span class="font-name">{f.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Gruppe „Schrift“: Oberflächenschrift, Codeschrift (nur Festbreite) und Textgröße. */
export function FontSettings() {
  const a = useAppearance();
  const pct = Math.round(a.fontScale * 100);
  return (
    <SettingsSection title="Schrift">
      <p class="settings-intro dim">Die Oberflächenschrift gilt für Texte und Bedienung. Code, Diff und Terminal bleiben in einer Festbreitenschrift.</p>
      <div class="font-block">
        <span class="setting-title">Oberfläche</span>
        <FontChoices label="Schriftart Oberfläche" value={a.fontUi} onPick={(fontUi) => setAppearance({ ...a, fontUi })} />
      </div>
      <div class="font-block">
        <span class="setting-title">Code und Diff</span>
        <FontChoices label="Schriftart Code" value={a.fontCode} monoOnly onPick={(fontCode) => setAppearance({ ...a, fontCode })} />
      </div>
      <SettingRow label="Schriftgröße" hint="nur Text — der Zoom skaliert die ganze Oberfläche">
        <span class="scale-control">
          <button class="btn" aria-label="Schriftgröße verringern" title="Schriftgröße verringern" disabled={a.fontScale <= FONT_SCALE_MIN} onClick={() => setAppearance({ ...a, fontScale: clampFontScale(a.fontScale - FONT_SCALE_STEP) })}>
            −
          </button>
          <span class="font-scale-value mono" aria-live="polite">
            {pct} %
          </span>
          <button class="btn" aria-label="Schriftgröße erhöhen" title="Schriftgröße erhöhen" disabled={a.fontScale >= FONT_SCALE_MAX} onClick={() => setAppearance({ ...a, fontScale: clampFontScale(a.fontScale + FONT_SCALE_STEP) })}>
            +
          </button>
          <button class="btn" aria-label="Schriftgröße zurücksetzen" disabled={a.fontScale === 1} onClick={() => setAppearance({ ...a, fontScale: 1 })}>
            100 %
          </button>
        </span>
      </SettingRow>
    </SettingsSection>
  );
}
