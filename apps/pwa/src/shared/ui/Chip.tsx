import type { ComponentChildren, ComponentProps } from "preact";


/**
 * EPIC-P63 T63.7: Chip-Baustein (Pille). Töne folgen den semantischen
 * Status-Tokens (Statusfarbe ≠ Akzentfarbe), `active` ist der gewählte
 * Zustand (aria-pressed). Stile: styles/ui/chip.css.
 */
export interface ChipProps extends Omit<Omit<ComponentProps<"button">, "class" | "size">, "class"> {
  tone?: "neutral" | "ok" | "warn" | "err" | "info";
  active?: boolean;
  /** Zeigt die ×-Taste und meldet das Entfernen (Screenreader-Text nötig). */
  onRemove?: () => void;
  removeLabel?: string;
  class?: string;
  children?: ComponentChildren;
}

export function Chip({ tone, active = false, onRemove, removeLabel, class: cls, children, ...rest }: ChipProps) {
  const classes = ["ui-chip", tone ? `ui-chip--${tone}` : null, active ? "active" : null, cls].filter(Boolean);
  return (
    <button type="button" aria-pressed={active} class={classes.join(" ")} {...rest}>
      {children}
      {onRemove && (
        <span
          role="button"
          tabindex={0}
          aria-label={removeLabel ?? "Entfernen"}
          class="ui-chip-remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onRemove();
            }
          }}
        >
          ✕
        </span>
      )}
    </button>
  );
}

/** Nicht-interaktive Variante (reine Mengen- und Dienstacker, vgl. `.pill`). */
export function ChipStatic({ tone, class: cls, children, ...rest }: Omit<ChipProps, "active" | "onRemove" | "removeLabel" | "onClick"> & Omit<ComponentProps<"span">, "class">) {
  const classes = ["ui-chip", "ui-chip--static", tone ? `ui-chip--${tone}` : null, cls].filter(Boolean);
  return (
    <span class={classes.join(" ")} {...rest}>
      {children}
    </span>
  );
}
