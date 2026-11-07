import type { ComponentChildren } from "preact";

/**
 * EPIC-P34 T34.3: die drei Bausteine aller Einstellungen. Jede Gruppe ist eine Karte mit Titel,
 * jede Zeile hat links Beschriftung und Hinweis, rechts das Bedienelement am gemeinsamen Rand.
 */
export function SettingsSection({ title, class: cls, children }: { title: string; class?: string; children: ComponentChildren }) {
  return (
    <section class={`card settings-section${cls ? ` ${cls}` : ""}`}>
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

/** Ein echter Schalter (`role="switch"`), per Tastatur und Screenreader wie eine Checkbox bedienbar. */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <span class="switch">
      <input type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled ?? false} onChange={(e) => onChange((e.currentTarget as HTMLInputElement).checked)} />
      <span class="switch-track" aria-hidden="true" />
    </span>
  );
}

/** Auswahl aus wenigen Werten, immer sichtbar (statt eines Knopfes, der den Gegenwert zeigt). */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (next: T) => void; label: string }) {
  return (
    <span class="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" class={o.value === value ? "active" : ""} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </span>
  );
}
