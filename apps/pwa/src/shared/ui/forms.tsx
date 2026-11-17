import type { ComponentChildren } from "preact";

/**
 * EPIC-P43 T43.1 (Kleinkram-Regel 7): die Formular-Bausteine der App — Feld, Auswahl, Schalter,
 * Segment. Alle setzen auf die nativen Elemente auf (Tastatur, Screenreader, Handy-Auswahlrad
 * bleiben), nur das Aussehen ist das der App. Stile: styles/37-forms.css und 24-settings.css.
 */
interface FieldFrame {
  label: string;
  /** Beschriftung nur für Screenreader — wenn der Ort das Feld schon erklärt. */
  hideLabel?: boolean;
  hint?: string;
  error?: string;
  /** Beschriftung links neben dem Feld statt darüber. */
  inline?: boolean;
  class?: string;
}

function Frame({ label, hideLabel, hint, error, inline, class: cls, children }: FieldFrame & { children: ComponentChildren }) {
  return (
    <label class={`field${inline ? " inline" : ""}${cls ? ` ${cls}` : ""}`} data-invalid={error ? "true" : undefined}>
      {!hideLabel && <span class="field-label">{label}</span>}
      {children}
      {error ? (
        <span class="field-error" role="alert">
          {error}
        </span>
      ) : (
        hint && <span class="field-hint">{hint}</span>
      )}
    </label>
  );
}

export function Field({
  value,
  onInput,
  type = "text",
  placeholder,
  disabled,
  maxLength,
  ...frame
}: FieldFrame & { value: string; onInput: (next: string) => void; type?: "text" | "search" | "url" | "password"; placeholder?: string; disabled?: boolean; maxLength?: number }) {
  return (
    <Frame {...frame}>
      <input
        class="field-input"
        // Preact typisiert <input> je type-Variante; ein Literal-Union passt zu keiner.
        {...({ type } as { type: "text" })}
        value={value}
        placeholder={placeholder}
        disabled={disabled ?? false}
        maxLength={maxLength}
        aria-label={frame.hideLabel ? frame.label : undefined}
        aria-invalid={frame.error ? true : undefined}
        onInput={(e) => onInput((e.currentTarget as HTMLInputElement).value)}
      />
    </Frame>
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  disabled,
  ...frame
}: FieldFrame & { value: T; options: readonly { value: T; label: string }[]; onChange: (next: T) => void; disabled?: boolean }) {
  return (
    <Frame {...frame}>
      <select
        class="field-select"
        value={value}
        disabled={disabled ?? false}
        aria-label={frame.hideLabel ? frame.label : undefined}
        aria-invalid={frame.error ? true : undefined}
        onChange={(e) => onChange((e.currentTarget as HTMLSelectElement).value as T)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Frame>
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
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: readonly { value: T; label: string }[]; onChange: (next: T) => void; label: string }) {
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
