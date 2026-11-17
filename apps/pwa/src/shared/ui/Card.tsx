import type { ComponentChildren, ComponentProps } from "preact";


/**
 * EPIC-P63 T63.7: Karten-Baustein — die Standardfläche für Inhalte
 * (--bg-elev, Chip-Rand). `elevated` hebt sie mit --shadow-elev ab.
 * Stile: styles/ui/card.css.
 */
export interface CardProps extends Omit<ComponentProps<"div">, "class"> {
  /** none: Fläche ohne Innenabstand (z. B. für eigene Raster). */
  padding?: "md" | "none";
  elevated?: boolean;
  class?: string;
  children?: ComponentChildren;
}

export function Card({ padding = "md", elevated, class: cls, children, ...rest }: CardProps) {
  const classes = ["ui-card", padding === "none" ? "ui-card--flush" : null, elevated ? "ui-card--elevated" : null, cls].filter(Boolean);
  return (
    <div class={classes.join(" ")} {...rest}>
      {children}
    </div>
  );
}
