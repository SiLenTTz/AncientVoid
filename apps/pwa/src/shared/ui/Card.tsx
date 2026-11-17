import type { ComponentChildren, ComponentProps } from "preact";


/**
 * EPIC-P63 T63.7: Karten-Baustein — die Standardfläche für Inhalte
 * (--bg-elev, Chip-Rand). `elevated` hebt sie mit --shadow-elev ab.
 * BUG-0205: ein `aria-label` ohne Role erzeugt keine benannte Region —
 * Karten mit Label bekommen `role="region"` zurück (Screenreader und E2E
 * finden sie wieder); ein explizit übergebenes `role` gewinnt weiterhin.
 * Stile: styles/ui/card.css.
 */
export interface CardProps extends Omit<ComponentProps<"div">, "class"> {
  /** none: Fläche ohne Innenabstand (z. B. für eigene Raster). */
  padding?: "md" | "none";
  elevated?: boolean;
  class?: string;
  children?: ComponentChildren;
}

export function Card({ padding = "md", elevated, class: cls, children, role, ...rest }: CardProps) {
  const classes = ["ui-card", padding === "none" ? "ui-card--flush" : null, elevated ? "ui-card--elevated" : null, cls].filter(Boolean);
  const label = (rest as { "aria-label"?: string })["aria-label"];
  return (
    <div class={classes.join(" ")} role={role ?? (label !== undefined ? "region" : undefined)} {...rest}>
      {children}
    </div>
  );
}
