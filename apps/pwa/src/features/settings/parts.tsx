import type { ComponentChildren } from "preact";

/**
 * EPIC-P34 T34.3: die drei Bausteine aller Einstellungen. Jede Gruppe ist eine Karte mit Titel,
 * jede Zeile hat links Beschriftung und Hinweis, rechts das Bedienelement am gemeinsamen Rand.
 */
export function SettingsSection({ title, class: cls, testid, children }: { title: string; class?: string; testid?: string; children: ComponentChildren }) {
  return (
    <section class={`card settings-section${cls ? ` ${cls}` : ""}`} data-testid={testid}>
      <header>
        <h3>{title}</h3>
      </header>
      <div class="settings-body form-grid">{children}</div>
    </section>
  );
}

export function SettingRow({ label, hint, children }: { label: string; hint?: string; children?: ComponentChildren }) {
  return (
    <div class="setting-row">
      <div class="setting-label">
        <span class="setting-title">{label}</span>
        {hint && <span class="dim setting-hint">{hint}</span>}
      </div>
      <div class="setting-control">{children}</div>
    </div>
  );
}

// EPIC-P43 T43.1: Schalter und Segment sind App-Bausteine (shared/forms.tsx); hier nur weitergereicht.
export { Segmented, Switch } from "../../shared/forms.tsx";
